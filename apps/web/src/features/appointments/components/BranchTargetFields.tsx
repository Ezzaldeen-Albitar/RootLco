'use client';

import { SelectField, TextField } from '@/components/forms/Field';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

/**
 * The company/branch pair every appointment surface must name (P1-28, Wave C).
 *
 * `GET /appointments` and `POST /appointments` both REQUIRE `companyId` and
 * `branchId` — a resource selector naming WHICH branch's calendar is read or
 * booked, carried as the authorization target (`P1-18-A-01`), never a scope
 * assertion. The server resolves the caller's own scope from the session and
 * refuses a client-asserted one (`P1-27-SEC-001`); what it will not do is guess
 * which of a multi-branch operator's branches a calendar is for.
 *
 * ## Why the options are the session's resolved ids
 *
 * The platform publishes no company or branch directory (the same contract gap
 * `admin.contractGap.noDirectory` records for approval limits), so there are no
 * names to offer — only the references the operator's own session resolves to.
 * An EMPTY resolved list means unrestricted within the workspace, not "no
 * access" (`session.ts`), and for that operator the reference is typed rather
 * than chosen, exactly as the approval-limits screen decided first.
 *
 * ## Why the select is uncontrolled and remounted on `attempt`
 *
 * React resets the form DOM once a Server Action settles, and a controlled
 * `value=` that is unchanged between renders is never re-written by the
 * reconciler — so the reset wins. On an ordinary field that loses a keystroke;
 * here it loses the AUTHORIZATION TARGET. The pair went blank after a refused
 * booking while the caller's state kept both ids, so the next submit sent a
 * company and a branch that nothing on screen was naming.
 *
 * The shape that survives is `key` + `defaultValue` + `onChange` together, the
 * same one `RecordForm` and `CustomerSelector` carry. The remount counter has to
 * come from the caller, because only the caller holds the action state — which
 * is why `form-reset-class.test.ts` checks every `<form action={…}>` call site
 * passes `attempt`, and why the prop defaults rather than being required: the
 * calendar screen renders this pair inside a `<form onSubmit={…}>`, which React
 * never resets, so an attempt counter there would describe nothing.
 */

function PairField({
  messages,
  label,
  ids,
  value,
  onChange,
  error,
  attempt,
  field,
}: {
  readonly messages: Messages;
  readonly label: string;
  readonly ids: readonly string[];
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly error: string | undefined;
  readonly attempt: number;
  /** Names the remount key, so the two pairs cannot share one. */
  readonly field: 'company' | 'branch';
}) {
  if (ids.length > 0) {
    return (
      <SelectField
        key={`${field}-target-${attempt}`}
        label={label}
        description={translate(messages, 'admin.contractGap.noDirectory')}
        required
        defaultValue={value}
        onChange={(event) => onChange(event.target.value)}
        options={ids.map((id) => ({ value: id, label: id }))}
        placeholder={translate(messages, 'field.selectPlaceholder')}
        error={error}
      />
    );
  }
  return (
    <TextField
      label={label}
      description={translate(messages, 'admin.scope.noneResolved')}
      required
      spellCheck={false}
      dir="ltr"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      error={error}
    />
  );
}

export function BranchTargetFields({
  messages,
  companyIds,
  branchIds,
  companyId,
  branchId,
  onCompanyChange,
  onBranchChange,
  companyError,
  branchError,
  attempt = 0,
}: {
  readonly messages: Messages;
  /** The session's resolved scope. Empty means unrestricted, not "none". */
  readonly companyIds: readonly string[];
  readonly branchIds: readonly string[];
  readonly companyId: string;
  readonly branchId: string;
  readonly onCompanyChange: (next: string) => void;
  readonly onBranchChange: (next: string) => void;
  readonly companyError?: string | undefined;
  readonly branchError?: string | undefined;
  /**
   * The caller's submission counter, so a settled Server Action remounts the
   * pair instead of leaving it blank while the caller's state keeps the ids.
   * Every `<form action={…}>` call site must pass it — see the docblock above.
   */
  readonly attempt?: number;
}) {
  return (
    <>
      <PairField
        messages={messages}
        label={translate(messages, 'admin.scope.companyId')}
        ids={companyIds}
        value={companyId}
        onChange={onCompanyChange}
        error={companyError}
        attempt={attempt}
        field="company"
      />
      <PairField
        messages={messages}
        label={translate(messages, 'admin.scope.branchId')}
        ids={branchIds}
        value={branchId}
        onChange={onBranchChange}
        error={branchError}
        attempt={attempt}
        field="branch"
      />
    </>
  );
}
