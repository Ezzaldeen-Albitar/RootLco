'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { OperationalGrid, type OperationalColumn } from '@/components/data/OperationalGrid';
import { readCompleteness } from '@/components/data-table/read-completeness';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable, type ServerTable } from '@/components/data-table/use-server-table';
import { FormCheckboxField } from '@/components/forms/mui/FormCheckboxField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { CustomerPicker, type ChosenCustomer } from '@/components/party/CustomerPicker';
import { PartyLabel } from '@/components/party/PartyLabel';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
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
  InstantOrRaw,
  RetryButton,
  StepOutcome,
  SubmitButton,
  WriteWithdrawn,
  useStepForm,
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
 * seen yet — and the grid's pager reaches the pages the filter never saw.
 *
 * ## On the Material UI wrappers (ADR-022)
 *
 * The read-back is `OperationalGrid` over the union's pages, drawing that
 * page's refusal rows; the form is `useStepForm` — every refusal on its field,
 * the cursor moved to the first, the entries kept and guarded as unsaved work;
 * the refusing party is chosen by name.
 */

interface RefusalDraft {
  readonly refusalType: string;
  readonly reasonId: string;
  readonly partner: ChosenCustomer | null;
  readonly witnessed: boolean;
}

const EMPTY_REFUSAL: RefusalDraft = {
  refusalType: '',
  reasonId: '',
  partner: null,
  witnessed: false,
};

/**
 * The page the union answered, with only its refusal rows drawn. The page, its
 * cursor and its `hasMore` are the server's; nothing is fetched or ordered here.
 */
function refusalsOf(table: ServerTable<AuthorizationEntry>): ServerTable<AuthorizationEntry> {
  const response = table.response;
  if (response === null) return table;
  return {
    ...table,
    response: { ...response, rows: response.rows.filter((row) => row.kind === 'refusal') },
  };
}

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
  const refusals = useMemo(() => refusalsOf(table), [table]);
  const rows = refusals.response?.rows ?? [];
  const completeness = readCompleteness(table.status, table.response?.hasMore, table.request.page);

  const columns = useMemo<readonly OperationalColumn<AuthorizationEntry>[]>(
    () => [
      {
        id: 'partner',
        headerKey: 'receptions.acknowledgement.columnParty',
        flex: 2,
        cell: (row) => (
          <PartyLabel
            messages={messages}
            party={{ partnerName: row.partnerDisplayName, partnerNumber: null, partnerType: null }}
          />
        ),
      },
      {
        id: 'standing',
        headerKey: 'receptions.authorization.standingHeader',
        cell: (row) =>
          row.isStanding ? translate(messages, 'receptions.authorization.standing') : '',
      },
      {
        id: 'occurredAt',
        headerKey: 'receptions.acknowledgement.columnRecordedAt',
        cell: (row) => <InstantOrRaw value={row.occurredAt} locale={locale} />,
      },
    ],
    [locale, messages]
  );

  const form = useStepForm<RefusalDraft>({
    messages,
    empty: EMPTY_REFUSAL,
    errorNames: { reasonId: 'refusalReasonId', partner: 'refusingPartnerId' },
    check: (draft) => {
      const found: Record<string, string> = {};
      if (draft.refusalType === '') {
        found['refusalType'] = 'receptions.refusal.error.typeRequired';
      } else if (
        // The mirror of `assertRefusalAttributable`: an authorization refusal
        // becomes the party's STANDING decision, so it must name the party.
        refusalRequiresPartner(draft.refusalType as RefusalType) &&
        draft.partner === null
      ) {
        found['refusingPartnerId'] = 'receptions.refusal.error.partnerRequired';
      }
      return found;
    },
    send: (draft, attempt) =>
      recordRefusal(
        visitId,
        {
          refusalType: draft.refusalType as RefusalType,
          // Omitted, never blanked: every one of these is `optional()` on a
          // `.strict()` schema, so an untouched control leaves the key off.
          ...(draft.reasonId === '' ? {} : { refusalReasonId: draft.reasonId }),
          ...(draft.partner === null ? {} : { refusingPartnerId: draft.partner.id }),
          ...(draft.witnessed ? { witnessEmployeeId: session.userId } : {}),
        },
        attempt
      ),
    settle: async (result) => {
      notifyActionResult(result, messages);
      if (result.status === 'success' || result.status === 'conflict') {
        await refresh();
        table.refresh();
      }
    },
  });
  const { draft } = form;
  const formRef = useFocusFirstInvalid(form.state);

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

        <OperationalGrid<AuthorizationEntry>
          messages={messages}
          locale={locale}
          label={translate(messages, 'receptions.refusal.heading')}
          columns={columns}
          rowId={(row) => row.id}
          table={refusals}
          density="compact"
          suppressEmptyState
          testId="refusal-grid"
        />
        {table.status === 'idle' && table.response !== null && rows.length === 0 ? (
          <p data-testid="refusal-read-back" className="text-body text-text-secondary">
            {translate(
              messages,
              completeness === 'truncated'
                ? 'receptions.refusal.emptyTruncated'
                : 'receptions.refusal.empty'
            )}
          </p>
        ) : null}
        {table.status === 'idle' && completeness === 'truncated' && rows.length > 0 ? (
          <p data-testid="refusal-more-pages" className="text-caption text-text-muted">
            {translate(messages, 'receptions.refusal.morePages')}
          </p>
        ) : null}
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
            ref={formRef}
            aria-label={translate(messages, 'receptions.refusal.formLabel')}
            onSubmit={form.onSubmit}
            noValidate
            className="flex flex-col gap-3"
          >
            <FormSelectField
              label={translate(messages, 'receptions.refusal.type')}
              description={translate(messages, 'receptions.refusal.typeHint')}
              required
              value={draft.refusalType}
              onChange={(value) => form.update('refusalType', value)}
              options={REFUSAL_TYPES.map((value) => ({
                value,
                label: translateDynamic(messages, `receptions.refusalType.${value}`),
              }))}
              placeholder={translate(messages, 'form.select.placeholder')}
              error={form.fieldError('refusalType')}
            />

            <RefusalReasonField
              locale={locale}
              messages={messages}
              catalogue={catalogue}
              value={draft.reasonId}
              onChange={(value) => form.update('reasonId', value)}
              error={form.fieldError('refusalReasonId')}
              onRetry={() => setAttempt((current) => current + 1)}
            />

            {capabilities.readCustomers ? (
              <CustomerPicker
                messages={messages}
                locale={locale}
                material
                label={translate(messages, 'receptions.refusal.partner')}
                value={draft.partner}
                onChange={(chosen) => form.update('partner', chosen)}
                canSearch
                error={form.fieldError('refusingPartnerId')}
                countsAsUnsaved={false}
                testId="refusal-partner"
              />
            ) : (
              <WriteWithdrawn
                locale={locale}
                messages={messages}
                messageKey="receptions.refusal.partnerNeedsCustomerRead"
              />
            )}

            <FormCheckboxField
              label={`${translate(messages, 'receptions.refusal.witness')} — ${session.displayName}`}
              description={translate(messages, 'receptions.refusal.witnessHint')}
              checked={draft.witnessed}
              onChange={(checked) => form.update('witnessed', checked)}
            />

            <StepOutcome messages={messages} state={form.state} />

            <SubmitButton
              messages={messages}
              pending={form.pending}
              labelKey="receptions.refusal.record"
            />
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
  error,
  onRetry,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly catalogue: IntakeCatalogueResult | null;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string | undefined;
  readonly onRetry: () => void;
}) {
  if (catalogue === null) {
    return (
      <EvidenceStates
        messages={messages}
        locale={locale}
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
        locale={locale}
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
          <RetryButton messages={messages} onRetry={onRetry} />
        </div>
      </div>
    );
  }

  return (
    <FormSelectField
      label={translate(messages, 'receptions.refusal.reason')}
      value={value}
      onChange={onChange}
      options={catalogue.options.map((option) => ({ value: option.id, label: option.name }))}
      placeholder={translate(messages, 'form.select.placeholder')}
      error={error}
    />
  );
}
