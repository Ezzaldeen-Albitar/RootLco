'use client';

import { useCallback, useState, useTransition } from 'react';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { CheckboxField, SelectField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { CustomerSelector, type SelectedCustomer } from '@/components/party/CustomerSelector';
import { PartyLabel } from '@/components/party/PartyLabel';
import {
  ErrorState,
  LoadingState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatDateTime } from '@/lib/format';
import type { ActionState } from '@/lib/forms/action-result';
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
 */

const IDLE: ActionState = { status: 'idle' };

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

  /* --- read-backs --------------------------------------------------------- */

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
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <h4 id="parties-roles-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'receptions.parties.rolesHeading')}
        </h4>

        <PartyRoleList messages={messages} table={roles} />

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
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <h4 id="parties-authorizations-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'receptions.authorization.heading')}
        </h4>

        <AuthorizationList locale={locale} messages={messages} table={authorizations} />

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

function ListStates({
  messages,
  status,
  correlationId,
  onRetry,
}: {
  readonly messages: Messages;
  readonly status: string;
  readonly correlationId: string | undefined;
  readonly onRetry: () => void;
}) {
  if (status === 'loading') return <LoadingState messages={messages} />;
  if (status === 'denied') {
    return (
      <PermissionDeniedState messages={messages} {...(correlationId ? { correlationId } : {})} />
    );
  }
  if (status === 'expired') return <SessionExpiredState messages={messages} />;
  return (
    <ErrorState
      messages={messages}
      action={
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {translate(messages, 'state.retry')}
        </button>
      }
      {...(correlationId ? { correlationId } : {})}
    />
  );
}

function PartyRoleList({
  messages,
  table,
}: {
  readonly messages: Messages;
  readonly table: ReturnType<typeof useServerTable<PartyRoleEntry>>;
}) {
  if (table.status !== 'idle') {
    return (
      <ListStates
        messages={messages}
        status={table.status}
        correlationId={table.correlationId}
        onRetry={table.refresh}
      />
    );
  }
  const rows = table.response?.rows ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-body text-text-secondary">
        {translate(messages, 'receptions.parties.rolesEmpty')}
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
          <PartyLabel
            messages={messages}
            party={{
              partnerName: row.partnerDisplayName,
              partnerNumber: row.partnerDisplayNumber,
              partnerType: null,
            }}
          />
          <span className="text-caption text-text-secondary">
            {translateDynamic(messages, `receptions.partyRole.${row.relationshipRole}`)}
          </span>
          {row.validTo === null ? (
            <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-caption text-text-secondary">
              {translate(messages, 'receptions.parties.roleActive')}
            </span>
          ) : (
            <span className="text-caption text-text-muted">
              {translate(messages, 'receptions.parties.roleEnded')}
            </span>
          )}
          {row.assignmentSource !== null ? (
            <span className="text-caption text-text-muted">{row.assignmentSource}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function AuthorizationList({
  locale,
  messages,
  table,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly table: ReturnType<typeof useServerTable<AuthorizationEntry>>;
}) {
  if (table.status !== 'idle') {
    return (
      <ListStates
        messages={messages}
        status={table.status}
        correlationId={table.correlationId}
        onRetry={table.refresh}
      />
    );
  }
  const rows = table.response?.rows ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-body text-text-secondary">
        {translate(messages, 'receptions.authorization.empty')}
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
      {rows.map((row) => (
        <li key={`${row.kind}-${row.id}`} className="flex flex-col gap-1 px-3 py-2">
          <div className="flex flex-wrap items-center gap-3">
            <PartyLabel
              messages={messages}
              party={{
                partnerName: row.partnerDisplayName,
                partnerNumber: null,
                partnerType: null,
              }}
            />
            {/* The union's two kinds, labelled as what each row IS: a refusal
                is refusal EVIDENCE (`rec.reception-refusal`), not an
                authorization dressed as declined. */}
            <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-caption text-text-secondary">
              {translate(
                messages,
                row.kind === 'refusal'
                  ? 'receptions.authorization.kindRefusal'
                  : 'receptions.authorization.kindAuthorization'
              )}
            </span>
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
            {row.isStanding ? (
              <span className="rounded-full border border-border px-2 py-0.5 text-caption text-text-secondary">
                {translate(messages, 'receptions.authorization.standing')}
              </span>
            ) : null}
          </div>
          <p className="text-caption text-text-muted">
            {row.authorizingRole !== null
              ? `${translateDynamic(messages, `receptions.authorizingRole.${row.authorizingRole}`)} · `
              : ''}
            {row.channel !== null
              ? `${translateDynamic(messages, `receptions.channel.${row.channel}`)} · `
              : ''}
            {formatDateTime(row.occurredAt, locale)}
          </p>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------------- *
 * Writes
 * ---------------------------------------------------------------------- */

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
  const [partner, setPartner] = useState<SelectedCustomer | null>(null);
  const [role, setRole] = useState('');
  const [source, setSource] = useState('');
  const [supersede, setSupersede] = useState(false);
  const [state, setState] = useState<ActionState>(IDLE);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (partner === null || role === '') {
      setState({
        status: 'invalid',
        messageKey:
          partner === null
            ? 'receptions.parties.error.partnerRequired'
            : 'receptions.parties.error.roleRequired',
        attempt: (state.attempt ?? 0) + 1,
      });
      return;
    }
    startTransition(async () => {
      const result = await assignPartyRole(
        visitId,
        {
          partnerId: partner.id,
          relationshipRole: role as (typeof RECEPTION_PARTY_ROLES)[number],
          assignmentSource: source.trim() === '' ? null : source.trim(),
          supersede,
        },
        (state.attempt ?? 0) + 1
      );
      setState(result);
      if (result.status === 'success') {
        setPartner(null);
        setRole('');
        setSource('');
        setSupersede(false);
      }
      await settle(result);
    });
  };

  return (
    <form
      aria-label={translate(messages, 'receptions.parties.formLabel')}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3 border-t border-border pt-3"
    >
      <CustomerSelector
        locale={locale}
        messages={messages}
        name="partnerId"
        labelKey="receptions.parties.partner"
        value={partner}
        onChange={setPartner}
        required
        attempt={state.attempt ?? 0}
      />
      <SelectField
        label={translate(messages, 'receptions.parties.role')}
        required
        value={role}
        onChange={(event) => setRole(event.target.value)}
        options={RECEPTION_PARTY_ROLES.map((value) => ({
          value,
          label: translateDynamic(messages, `receptions.partyRole.${value}`),
        }))}
        placeholder={translate(messages, 'form.select.placeholder')}
      />
      <TextField
        label={translate(messages, 'receptions.parties.source')}
        description={translate(messages, 'receptions.parties.sourceHint')}
        optionalHint={translate(messages, 'form.optional')}
        value={source}
        maxLength={MAX_ASSIGNMENT_SOURCE}
        onChange={(event) => setSource(event.target.value)}
      />
      <CheckboxField
        label={translate(messages, 'receptions.parties.supersede')}
        description={translate(messages, 'receptions.parties.supersedeHint')}
        checked={supersede}
        onChange={(event) => setSupersede(event.target.checked)}
      />

      <Outcome messages={messages} state={state} />

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {pending
            ? translate(messages, 'form.pending')
            : translate(messages, 'receptions.parties.assign')}
        </button>
      </div>
    </form>
  );
}

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
  const [partner, setPartner] = useState<SelectedCustomer | null>(null);
  const [role, setRole] = useState('');
  const [decision, setDecision] = useState('');
  const [channel, setChannel] = useState('');
  const [state, setState] = useState<ActionState>(IDLE);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const missing =
      partner === null
        ? 'receptions.parties.error.partnerRequired'
        : role === ''
          ? 'receptions.authorization.error.roleRequired'
          : decision === ''
            ? 'receptions.authorization.error.decisionRequired'
            : null;
    if (missing !== null) {
      setState({ status: 'invalid', messageKey: missing, attempt: (state.attempt ?? 0) + 1 });
      return;
    }
    startTransition(async () => {
      const result = await recordAuthorization(
        visitId,
        {
          authorizingRole: role as (typeof AUTHORIZING_ROLES)[number],
          partnerId: (partner as SelectedCustomer).id,
          decision: decision as (typeof AUTHORIZATION_DECISIONS)[number],
          ...(channel !== ''
            ? { channel: channel as (typeof AUTHORIZATION_CHANNELS)[number] }
            : {}),
        },
        (state.attempt ?? 0) + 1
      );
      setState(result);
      if (result.status === 'success') {
        setPartner(null);
        setRole('');
        setDecision('');
        setChannel('');
      }
      await settle(result);
    });
  };

  return (
    <form
      aria-label={translate(messages, 'receptions.authorization.formLabel')}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3 border-t border-border pt-3"
    >
      <p className="text-caption text-text-muted" lang={locale}>
        {/* Both decisions are first-class; a decline recorded here is the
            party's standing answer until the same party approves later. */}
        {translate(messages, 'receptions.authorization.hint')}
      </p>
      <CustomerSelector
        locale={locale}
        messages={messages}
        name="authorizationPartnerId"
        labelKey="receptions.authorization.partner"
        value={partner}
        onChange={setPartner}
        required
        attempt={state.attempt ?? 0}
      />
      <SelectField
        label={translate(messages, 'receptions.authorization.role')}
        description={translate(messages, 'receptions.authorization.roleHint')}
        required
        value={role}
        onChange={(event) => setRole(event.target.value)}
        options={AUTHORIZING_ROLES.map((value) => ({
          value,
          label: translateDynamic(messages, `receptions.authorizingRole.${value}`),
        }))}
        placeholder={translate(messages, 'form.select.placeholder')}
      />
      <SelectField
        label={translate(messages, 'receptions.authorization.decision')}
        required
        value={decision}
        onChange={(event) => setDecision(event.target.value)}
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
      />
      <SelectField
        label={translate(messages, 'receptions.authorization.channel')}
        optionalHint={translate(messages, 'form.optional')}
        value={channel}
        onChange={(event) => setChannel(event.target.value)}
        options={AUTHORIZATION_CHANNELS.map((value) => ({
          value,
          label: translateDynamic(messages, `receptions.channel.${value}`),
        }))}
        placeholder={translate(messages, 'form.select.placeholder')}
      />

      <Outcome messages={messages} state={state} />

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {pending
            ? translate(messages, 'form.pending')
            : translate(messages, 'receptions.authorization.record')}
        </button>
      </div>
    </form>
  );
}

/** The form's inline outcome line. The toast is raised by `settle`. */
function Outcome({
  messages,
  state,
}: {
  readonly messages: Messages;
  readonly state: ActionState;
}) {
  if (state.status === 'idle' || state.status === 'success') return null;
  return (
    <p role="alert" className="text-body text-error">
      {state.status === 'conflict'
        ? // Deliberately does not guess WHICH rule refused: role-not-held and
          // the state guard answer the same non-disclosing 409 `ERR-TRN-001`.
          translate(messages, 'receptions.authorization.conflict')
        : state.messageKey
          ? translateDynamic(messages, state.messageKey)
          : translate(messages, 'action.failed')}
      {state.correlationId ? (
        <code className="ms-2 font-mono text-caption">{state.correlationId}</code>
      ) : null}
    </p>
  );
}
