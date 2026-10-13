'use client';

import { useCallback, useMemo } from 'react';
import { OperationalGrid, type OperationalColumn } from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { FormCheckboxField } from '@/components/forms/mui/FormCheckboxField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { CustomerPicker, type ChosenCustomer } from '@/components/party/CustomerPicker';
import { PartyLabel } from '@/components/party/PartyLabel';
import { FailureExplanation } from '@/components/states/States';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic, translateWithValues } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import {
  assignPartyRole,
  listAuthorizations,
  listPartyRoles,
  recordAuthorization,
} from '../../api';
import {
  AUTHORIZATION_CHANNELS,
  AUTHORIZATION_DECISIONS,
  AUTHORIZING_ROLES,
  MAX_ASSIGNMENT_SOURCE,
  RECEPTION_PARTY_ROLES,
  type AuthorizationEntry,
  type PartyRoleEntry,
} from '../../receptions-contract';
import type { CheckInStepProps } from '../../check-in/wizard';
import { refusalReasonKey } from '../../check-in/closure';
import { InstantOrRaw, SubmitButton, useStepForm } from './EvidencePanels';

/**
 * Party roles and authorization (`FE-009`).
 *
 * Two writes, two permissions, and a read-back that renders BOTH kinds of
 * decision:
 *
 *   - `rec.reception-party-role` (`rec.reception.party.manage`) appends a dated
 *     role assignment; `supersede` closes a prior open interval in the SAME
 *     role first, and is asked for explicitly because doing it implicitly would
 *     silently re-date history.
 *   - `rec.reception-authorization` (`rec.reception.authorization.verify`)
 *     records an authorizing party's decision — `approved` OR `declined`, both
 *     first-class.
 *   - `rec.reception-authorization-list` is a TWO-TABLE UNION: authorization
 *     decisions and `authorization`-type refusal evidence arrive as one list,
 *     because reading only approvals would report a withdrawn consent as
 *     standing. Every row renders with its partner attribution and its
 *     `isStanding` marker; a refusal row is labelled a refusal, never dressed
 *     as a declined authorization.
 *
 * ## Conflicts here are verdicts, and the step re-reads after every one
 *
 * Whether the partner actually holds an authorizing role is the database
 * guard's verdict, and role-not-held is a deliberately non-disclosing
 * 409 `ERR-TRN-001` (anti-probing) — the same answer the state guard gives.
 * The copy therefore does not guess WHICH rule refused. After any conflict the
 * step calls `refresh()` — the shell re-reads the detail — and re-reads its own
 * lists, so what the operator sees next is the current truth, not the state
 * that lost the race.
 *
 * ## On the Material UI wrappers (ADR-022)
 *
 * Both lists are `OperationalGrid` over the same reads (the server's pages
 * walked with its cursor, every state the grid's own). Both forms are
 * `useStepForm`: the party is chosen by name (`CustomerPicker`), every refusal
 * is marked on the field it is about with the cursor moved there, and anything
 * entered is unsaved work.
 */

export function PartiesStep({
  locale,
  messages,
  visitId,
  recordVersion,
  capabilities,
  writesLocked,
  refresh,
}: CheckInStepProps) {
  const readKey = `${visitId}:${recordVersion}`;

  /* --- the two read-backs ------------------------------------------------ */

  const loadRoles = useCallback(
    (request: Parameters<typeof listPartyRoles>[2], cursor: string | null) =>
      listPartyRoles(visitId, undefined, request, cursor),
    [visitId]
  );
  const roles = useServerTable<PartyRoleEntry>(loadRoles, {
    initial: { ...INITIAL_REQUEST, pageSize: 25 },
    loadKey: readKey,
  });

  const loadAuthorizations = useCallback(
    (request: Parameters<typeof listAuthorizations>[1], cursor: string | null) =>
      listAuthorizations(visitId, request, cursor),
    [visitId]
  );
  const authorizations = useServerTable<AuthorizationEntry>(loadAuthorizations, {
    initial: { ...INITIAL_REQUEST, pageSize: 25 },
    loadKey: readKey,
  });

  const settle = async (state: ActionState) => {
    notifyActionResult(state, messages);
    if (state.status === 'success' || state.status === 'conflict') {
      // Success: the lists must show the new row. Conflict: the truth moved
      // under us — re-read the detail AND the lists before the operator acts
      // again (the 409 re-read rule).
      await refresh();
      roles.refresh();
      authorizations.refresh();
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section
        aria-labelledby="parties-roles-heading"
        className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <h4 id="parties-roles-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'receptions.parties.rolesHeading')}
        </h4>

        <PartyRoleGrid locale={locale} messages={messages} table={roles} />

        {writesLocked ? null : capabilities.manageParties ? (
          capabilities.readCustomers ? (
            <PartyRoleForm locale={locale} messages={messages} visitId={visitId} settle={settle} />
          ) : (
            // The form NEEDS the customer search to name a partner; without
            // `crm.customer.read` it cannot work, and rendering it broken would
            // read as a defect. Said, not greyed.
            <p className="text-caption text-text-muted" lang={locale}>
              {translate(messages, 'receptions.parties.needsCustomerRead')}
            </p>
          )
        ) : (
          <p className="text-caption text-text-muted" lang={locale}>
            {translate(messages, 'receptions.parties.rolesReadOnly')}
          </p>
        )}
      </section>

      <section
        aria-labelledby="parties-authorizations-heading"
        className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <h4 id="parties-authorizations-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'receptions.authorization.heading')}
        </h4>

        <AuthorizationGrid locale={locale} messages={messages} table={authorizations} />

        {writesLocked ? null : capabilities.verifyAuthorizations ? (
          capabilities.readCustomers ? (
            <AuthorizationForm
              locale={locale}
              messages={messages}
              visitId={visitId}
              settle={settle}
            />
          ) : (
            <p className="text-caption text-text-muted" lang={locale}>
              {translate(messages, 'receptions.parties.needsCustomerRead')}
            </p>
          )
        ) : (
          <p className="text-caption text-text-muted" lang={locale}>
            {translate(messages, 'receptions.authorization.readOnly')}
          </p>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------- *
 * Read-backs
 * ---------------------------------------------------------------------- */

/** The visit's party roles, open and closed, each by name. */
export function PartyRoleGrid({
  locale,
  messages,
  table,
  showInterval = true,
  emptyKey = 'receptions.parties.rolesEmpty',
  testId = 'party-role-grid',
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly table: ReturnType<typeof useServerTable<PartyRoleEntry>>;
  /** Whether the open/ended marker and the assignment source are drawn. */
  readonly showInterval?: boolean;
  /** What an empty answer says — the summary names ACTIVE roles only. */
  readonly emptyKey?: 'receptions.parties.rolesEmpty' | 'receptions.summary.partiesEmpty';
  readonly testId?: string;
}) {
  const columns = useMemo<readonly OperationalColumn<PartyRoleEntry>[]>(
    () => [
      {
        id: 'partner',
        headerKey: 'receptions.acknowledgement.columnParty',
        flex: 2,
        cell: (row) => (
          <PartyLabel
            messages={messages}
            party={{
              partnerName: row.partnerDisplayName,
              partnerNumber: row.partnerDisplayNumber,
              partnerType: null,
            }}
          />
        ),
      },
      {
        id: 'role',
        headerKey: 'receptions.parties.role',
        cell: (row) => translateDynamic(messages, `receptions.partyRole.${row.relationshipRole}`),
      },
      ...(showInterval
        ? [
            {
              id: 'interval',
              headerKey: 'receptions.wizard.status',
              cell: (row: PartyRoleEntry) =>
                translate(
                  messages,
                  row.validTo === null
                    ? 'receptions.parties.roleActive'
                    : 'receptions.parties.roleEnded'
                ),
            },
            {
              id: 'source',
              headerKey: 'receptions.parties.source',
              hideBelow: 'md' as const,
              cell: (row: PartyRoleEntry) => row.assignmentSource ?? '',
            },
          ]
        : []),
    ],
    [messages, showInterval]
  );
  const rows = table.response?.rows ?? [];

  return (
    <>
      <OperationalGrid<PartyRoleEntry>
        messages={messages}
        locale={locale}
        label={translate(messages, 'receptions.parties.rolesHeading')}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        density="compact"
        suppressEmptyState
        testId={testId}
      />
      {table.status === 'idle' && table.response !== null && rows.length === 0 ? (
        <p className="text-body text-text-secondary">{translate(messages, emptyKey)}</p>
      ) : null}
    </>
  );
}

/** Authorizations AND authorization-type refusals, one union, each labelled. */
function AuthorizationGrid({
  locale,
  messages,
  table,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly table: ReturnType<typeof useServerTable<AuthorizationEntry>>;
}) {
  const columns = useMemo<readonly OperationalColumn<AuthorizationEntry>[]>(
    () => authorizationColumns(locale, messages, 'detail'),
    [locale, messages]
  );
  const rows = table.response?.rows ?? [];

  return (
    <>
      <OperationalGrid<AuthorizationEntry>
        messages={messages}
        locale={locale}
        label={translate(messages, 'receptions.authorization.heading')}
        columns={columns}
        rowId={(row) => `${row.kind}-${row.id}`}
        table={table}
        density="compact"
        suppressEmptyState
        testId="authorization-grid"
      />
      {table.status === 'idle' && table.response !== null && rows.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'receptions.authorization.empty')}
        </p>
      ) : null}
    </>
  );
}

/**
 * The columns an authorization row is drawn with — shared with the summary, so
 * the two surfaces cannot disagree about what a row says. `detail` adds the
 * authorizing role and the channel; `summary` says standing or superseded.
 */
export function authorizationColumns(
  locale: Locale,
  messages: Messages,
  shape: 'detail' | 'summary'
): readonly OperationalColumn<AuthorizationEntry>[] {
  return [
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
      id: 'decision',
      headerKey: 'receptions.authorization.decision',
      cell: (row) => (
        <span
          className={
            row.decision === 'approved'
              ? 'text-caption font-medium text-success'
              : 'text-caption font-medium text-error'
          }
        >
          {translate(
            messages,
            row.decision === 'approved'
              ? 'receptions.authorization.approved'
              : 'receptions.authorization.declined'
          )}
        </span>
      ),
    },
    {
      id: 'kind',
      headerKey: 'receptions.acknowledgement.columnRecord',
      cell: (row) =>
        translate(
          messages,
          row.kind === 'refusal'
            ? 'receptions.authorization.kindRefusal'
            : 'receptions.authorization.kindAuthorization'
        ),
    },
    {
      id: 'standing',
      headerKey: 'receptions.authorization.standingHeader',
      cell: (row) =>
        row.isStanding
          ? translate(messages, 'receptions.authorization.standing')
          : shape === 'summary'
            ? translate(messages, 'receptions.summary.supersededDecision')
            : '',
    },
    ...(shape === 'detail'
      ? [
          {
            id: 'how',
            headerKey: 'receptions.authorization.channel',
            hideBelow: 'md' as const,
            cell: (row: AuthorizationEntry) =>
              [
                row.authorizingRole !== null
                  ? translateDynamic(messages, `receptions.authorizingRole.${row.authorizingRole}`)
                  : null,
                row.channel !== null
                  ? translateDynamic(messages, `receptions.channel.${row.channel}`)
                  : null,
              ]
                .filter((part): part is string => part !== null)
                .join(' · '),
          },
        ]
      : []),
    {
      id: 'occurredAt',
      headerKey: 'receptions.acknowledgement.columnRecordedAt',
      cell: (row) => <InstantOrRaw value={row.occurredAt} locale={locale} />,
    },
  ];
}

/* ---------------------------------------------------------------------- *
 * Forms
 * ---------------------------------------------------------------------- */

interface RoleDraft {
  readonly partner: ChosenCustomer | null;
  readonly role: string;
  readonly source: string;
  readonly supersede: boolean;
}

const EMPTY_ROLE: RoleDraft = { partner: null, role: '', source: '', supersede: false };

function PartyRoleForm({
  locale,
  messages,
  visitId,
  settle,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly visitId: string;
  readonly settle: (state: ActionState) => Promise<void>;
}) {
  const form = useStepForm<RoleDraft>({
    messages,
    empty: EMPTY_ROLE,
    errorNames: { partner: 'partnerId', role: 'relationshipRole', source: 'assignmentSource' },
    check: (draft) => {
      const found: Record<string, string> = {};
      if (draft.partner === null) found['partnerId'] = 'receptions.parties.error.partnerRequired';
      if (draft.role === '') found['relationshipRole'] = 'receptions.parties.error.roleRequired';
      return found;
    },
    send: (draft, attempt) =>
      assignPartyRole(
        visitId,
        {
          partnerId: (draft.partner as ChosenCustomer).id,
          relationshipRole: draft.role as (typeof RECEPTION_PARTY_ROLES)[number],
          assignmentSource: draft.source.trim() === '' ? null : draft.source.trim(),
          supersede: draft.supersede,
        },
        attempt
      ),
    settle,
  });
  const { draft } = form;
  const formRef = useFocusFirstInvalid(form.state);

  return (
    <form
      ref={formRef}
      aria-label={translate(messages, 'receptions.parties.formLabel')}
      onSubmit={form.onSubmit}
      noValidate
      className="flex flex-col gap-3 border-t border-border pt-3"
    >
      <CustomerPicker
        messages={messages}
        locale={locale}
        material
        label={translate(messages, 'receptions.parties.partner')}
        value={draft.partner}
        onChange={(chosen) => form.update('partner', chosen)}
        canSearch
        error={form.fieldError('partnerId')}
        countsAsUnsaved={false}
        testId="party-role-partner"
      />
      <FormSelectField
        label={translate(messages, 'receptions.parties.role')}
        required
        value={draft.role}
        onChange={(value) => form.update('role', value)}
        options={RECEPTION_PARTY_ROLES.map((value) => ({
          value,
          label: translateDynamic(messages, `receptions.partyRole.${value}`),
        }))}
        placeholder={translate(messages, 'form.select.placeholder')}
        error={form.fieldError('relationshipRole')}
      />
      <FormTextField
        label={translate(messages, 'receptions.parties.source')}
        description={translate(messages, 'receptions.parties.sourceHint')}
        value={draft.source}
        maxLength={MAX_ASSIGNMENT_SOURCE}
        onChange={(value) => form.update('source', value)}
        error={form.fieldError('assignmentSource')}
      />
      <FormCheckboxField
        label={translate(messages, 'receptions.parties.supersede')}
        description={translate(messages, 'receptions.parties.supersedeHint')}
        checked={draft.supersede}
        onChange={(checked) => form.update('supersede', checked)}
      />

      <Outcome messages={messages} state={form.state} />

      <SubmitButton
        messages={messages}
        pending={form.pending}
        labelKey="receptions.parties.assign"
      />
    </form>
  );
}

interface AuthorizationDraft {
  readonly partner: ChosenCustomer | null;
  readonly role: string;
  readonly decision: string;
  readonly channel: string;
}

const EMPTY_AUTHORIZATION: AuthorizationDraft = {
  partner: null,
  role: '',
  decision: '',
  channel: '',
};

function AuthorizationForm({
  locale,
  messages,
  visitId,
  settle,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly visitId: string;
  readonly settle: (state: ActionState) => Promise<void>;
}) {
  const form = useStepForm<AuthorizationDraft>({
    messages,
    empty: EMPTY_AUTHORIZATION,
    errorNames: { partner: 'partnerId', role: 'authorizingRole' },
    check: (draft) => {
      const found: Record<string, string> = {};
      if (draft.partner === null) found['partnerId'] = 'receptions.parties.error.partnerRequired';
      if (draft.role === '') {
        found['authorizingRole'] = 'receptions.authorization.error.roleRequired';
      }
      if (draft.decision === '') {
        found['decision'] = 'receptions.authorization.error.decisionRequired';
      }
      return found;
    },
    send: (draft, attempt) =>
      recordAuthorization(
        visitId,
        {
          authorizingRole: draft.role as (typeof AUTHORIZING_ROLES)[number],
          partnerId: (draft.partner as ChosenCustomer).id,
          decision: draft.decision as (typeof AUTHORIZATION_DECISIONS)[number],
          ...(draft.channel !== ''
            ? { channel: draft.channel as (typeof AUTHORIZATION_CHANNELS)[number] }
            : {}),
        },
        attempt
      ),
    settle,
  });
  const { draft } = form;
  const formRef = useFocusFirstInvalid(form.state);

  return (
    <form
      ref={formRef}
      aria-label={translate(messages, 'receptions.authorization.formLabel')}
      onSubmit={form.onSubmit}
      noValidate
      className="flex flex-col gap-3 border-t border-border pt-3"
    >
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'receptions.authorization.hint')}
      </p>
      <CustomerPicker
        messages={messages}
        locale={locale}
        material
        label={translate(messages, 'receptions.authorization.partner')}
        value={draft.partner}
        onChange={(chosen) => form.update('partner', chosen)}
        canSearch
        error={form.fieldError('partnerId')}
        countsAsUnsaved={false}
        testId="authorization-partner"
      />
      <FormSelectField
        label={translate(messages, 'receptions.authorization.role')}
        description={translate(messages, 'receptions.authorization.roleHint')}
        required
        value={draft.role}
        onChange={(value) => form.update('role', value)}
        options={AUTHORIZING_ROLES.map((value) => ({
          value,
          label: translateDynamic(messages, `receptions.authorizingRole.${value}`),
        }))}
        placeholder={translate(messages, 'form.select.placeholder')}
        error={form.fieldError('authorizingRole')}
      />
      <FormSelectField
        label={translate(messages, 'receptions.authorization.decision')}
        required
        value={draft.decision}
        onChange={(value) => form.update('decision', value)}
        options={AUTHORIZATION_DECISIONS.map((value) => ({
          value,
          label: translate(
            messages,
            value === 'approved'
              ? 'receptions.authorization.approved'
              : 'receptions.authorization.declined'
          ),
        }))}
        placeholder={translate(messages, 'form.select.placeholder')}
        error={form.fieldError('decision')}
      />
      <FormSelectField
        label={translate(messages, 'receptions.authorization.channel')}
        value={draft.channel}
        onChange={(value) => form.update('channel', value)}
        options={AUTHORIZATION_CHANNELS.map((value) => ({
          value,
          label: translateDynamic(messages, `receptions.channel.${value}`),
        }))}
        placeholder={translate(messages, 'form.select.placeholder')}
        error={form.fieldError('channel')}
      />

      <Outcome messages={messages} state={form.state} />

      <SubmitButton
        messages={messages}
        pending={form.pending}
        labelKey="receptions.authorization.record"
      />
    </form>
  );
}

/**
 * The form's inline outcome line. The toast is raised by `settle`.
 *
 * A conflict used to be printed as one fixed sentence, on the grounds that the
 * line must not guess WHICH rule refused — role-not-held and the state guard
 * both answer the same non-disclosing 409. That reasoning held while the API
 * said nothing beyond the code, and it stopped holding when the API began
 * publishing a rule token beside the refusal: there is no guessing left to do.
 * `refusalReasonKey` recognises only the tokens this module has been told about,
 * so an unfamiliar one still falls back to the fixed sentence, and the tokens it
 * does recognise say no more than the API's own wording does — the party may not
 * approve here, or the visit is closed. Nothing about which roles a party holds
 * is added by either.
 */
function Outcome({
  messages,
  state,
}: {
  readonly messages: Messages;
  readonly state: ActionState;
}) {
  if (state.status === 'idle' || state.status === 'success') return null;
  const stated = state.status === 'conflict' ? refusalReasonKey(state.messageKey) : null;
  return (
    <p role="alert" className="text-body text-error">
      {state.status === 'conflict'
        ? stated !== null
          ? translateDynamic(messages, stated)
          : translate(messages, 'receptions.authorization.conflict')
        : state.messageKey
          ? translateWithValues(messages, state.messageKey, state.messageValues)
          : translate(messages, 'action.failed')}
      <FailureExplanation messages={messages} messageKey={state.messageKey ?? ''} />
      {state.correlationId ? (
        <code className="ms-2 font-mono text-caption">{state.correlationId}</code>
      ) : null}
    </p>
  );
}
