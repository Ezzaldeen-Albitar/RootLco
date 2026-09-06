'use client';

import { useEffect, useMemo, useState } from 'react';

import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { SelectField, TextField } from '@/components/forms/Field';
import { listServices } from '@/features/services/api';
import type { BranchOption, ServiceSummary } from '@/features/services/services-contract';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';

import { listBranches } from '../api';
import type { ActivationState, PriceListVersionState } from '../pricing-contract';

/**
 * Pieces the two pricing screens share (P1-30, `W2`).
 *
 * Nothing here touches money. A branch is a pair of identifiers the backend
 * re-authorizes; a service is an identifier the backend resolves; both are
 * offered as lists when the operator may read them and as identifier fields
 * when they may not, because a refused list must never render as "there are
 * none".
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PRIMARY_BUTTON =
  'rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover';
export const SECONDARY_BUTTON =
  'rounded-md border border-border bg-surface px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard';

/* ------------------------------------------------------------------ *
 * Branches
 * ------------------------------------------------------------------ */

export interface Branches {
  readonly items: readonly BranchOption[] | null;
  /** A message key when the list could not be read, else `null`. */
  readonly refused: string | null;
  /** Whether a list was even requested — false without `org.branch.read`. */
  readonly offered: boolean;
}

export function useBranches(canRead: boolean): Branches {
  const [items, setItems] = useState<readonly BranchOption[] | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => {
    if (!canRead) return;
    let live = true;
    void listBranches().then((state) => {
      if (!live) return;
      if (state.status === 'ok') setItems(state.data.items);
      else setRefused('pricing.common.branchesRefused');
    });
    return () => {
      live = false;
    };
  }, [canRead]);
  return { items, refused, offered: canRead };
}

/** A company/branch pair as the forms hold it; both empty means "not narrowed". */
export interface BranchPair {
  readonly companyId: string;
  readonly branchId: string;
}

export const EMPTY_PAIR: BranchPair = { companyId: '', branchId: '' };

/**
 * A branch as a list when the operator may read one — choosing a branch fills
 * its company too — and as two identifier fields when they may not.
 */
export function BranchPairPicker({
  messages,
  branches,
  label,
  placeholder,
  value,
  onChange,
  required,
  errors,
}: {
  readonly messages: Messages;
  readonly branches: Branches;
  readonly label: string;
  readonly placeholder: string;
  readonly value: BranchPair;
  readonly onChange: (next: BranchPair) => void;
  readonly required?: boolean;
  readonly errors?: Readonly<Record<string, string | undefined>>;
}) {
  if (branches.offered && branches.items !== null) {
    return (
      <SelectField
        label={label}
        {...(required ? { required: true } : {})}
        value={value.branchId}
        onChange={(event) => {
          const chosen = branches.items?.find((branch) => branch.id === event.target.value);
          onChange(
            chosen ? { companyId: chosen.companyId, branchId: chosen.id } : { ...EMPTY_PAIR }
          );
        }}
        options={branches.items.map((branch) => ({
          value: branch.id,
          label: `${branch.branchCode} — ${branch.name}`,
        }))}
        placeholder={placeholder}
        error={errors?.['branchId']}
      />
    );
  }
  return (
    <>
      <TextField
        label={translate(messages, 'pricing.common.companyIdField')}
        description={
          branches.refused
            ? translateDynamic(messages, branches.refused)
            : translate(messages, 'pricing.common.identifierHelp')
        }
        {...(required ? { required: true } : {})}
        spellCheck={false}
        dir="ltr"
        value={value.companyId}
        onChange={(event) => onChange({ ...value, companyId: event.target.value })}
        error={errors?.['companyId']}
      />
      <TextField
        label={translate(messages, 'pricing.common.branchIdField')}
        {...(required ? { required: true } : {})}
        spellCheck={false}
        dir="ltr"
        value={value.branchId}
        onChange={(event) => onChange({ ...value, branchId: event.target.value })}
        error={errors?.['branchId']}
      />
    </>
  );
}

/** A label lookup for a branch identifier — the code and name when the list holds it. */
export function branchLabel(branches: Branches, branchId: string): string | null {
  const found = branches.items?.find((branch) => branch.id === branchId);
  return found ? `${found.branchCode} — ${found.name}` : null;
}

/* ------------------------------------------------------------------ *
 * Services
 * ------------------------------------------------------------------ */

/**
 * A service, found by the beginning of its code or name through
 * `svc.service-list` when the operator holds `svc.service.read`, and named by
 * identifier when they do not. The search is explicit — a button, never a
 * keystroke — and asks for one page.
 */
export function ServicePicker({
  messages,
  canRead,
  label,
  value,
  onChange,
  error,
}: {
  readonly messages: Messages;
  readonly canRead: boolean;
  readonly label: string;
  readonly value: string;
  readonly onChange: (serviceId: string) => void;
  readonly error?: string | undefined;
}) {
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<readonly ServiceSummary[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    const needle = term.trim();
    setBusy(true);
    const page = await listServices(needle ? { search: needle } : {}, INITIAL_REQUEST, null);
    setBusy(false);
    if (page.status === 'ok') {
      setFound(page.rows);
      setNote(page.rows.length === 0 ? 'pricing.picker.noServices' : null);
    } else {
      setFound(null);
      setNote(
        page.status === 'denied' ? 'pricing.picker.servicesRefused' : 'pricing.picker.searchFailed'
      );
    }
  };

  const options = useMemo(
    () =>
      (found ?? []).map((service) => ({
        value: service.id,
        label: `${service.serviceCode} — ${service.name}`,
      })),
    [found]
  );

  if (!canRead) {
    return (
      <TextField
        label={translate(messages, 'pricing.picker.serviceIdField')}
        description={translate(messages, 'pricing.picker.servicesNotReadable')}
        required
        spellCheck={false}
        dir="ltr"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        error={error}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <div className="grow">
          <TextField
            label={translate(messages, 'pricing.picker.serviceSearch')}
            description={translate(messages, 'pricing.picker.serviceSearchHelp')}
            spellCheck={false}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </div>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          disabled={busy}
          onClick={() => {
            void search();
          }}
        >
          {translate(messages, 'pricing.picker.search')}
        </button>
      </div>
      <SelectField
        label={label}
        required
        {...(note ? { description: translateDynamic(messages, note) } : {})}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        options={options}
        placeholder={translate(messages, 'pricing.picker.chooseService')}
        error={error}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Badges and notes
 * ------------------------------------------------------------------ */

export function ActivationBadge({
  messages,
  status,
}: {
  readonly messages: Messages;
  readonly status: ActivationState;
}) {
  const label = translateDynamic(messages, `pricing.status.${status}`);
  if (status === 'inactive') {
    return (
      <span className="rounded-md border border-border px-2 py-0.5 text-caption text-text-secondary">
        {label}
      </span>
    );
  }
  return <span className="text-body">{label}</span>;
}

export function VersionStatusBadge({
  messages,
  status,
}: {
  readonly messages: Messages;
  readonly status: PriceListVersionState;
}) {
  const label = translateDynamic(messages, `pricing.versionStatus.${status}`);
  if (status === 'published') {
    return (
      <span className="rounded-md bg-primary px-2 py-0.5 text-caption font-medium text-on-primary">
        {label}
      </span>
    );
  }
  return (
    <span className="rounded-md border border-border px-2 py-0.5 text-caption text-text-secondary">
      {label}
    </span>
  );
}

/** A failed outcome beside the form that caused it, with its reference. */
export function OutcomeNote({
  messages,
  outcome,
}: {
  readonly messages: Messages;
  readonly outcome: ActionState | null;
}) {
  if (!outcome || outcome.status === 'idle' || outcome.status === 'success') return null;
  const key = outcome.messageKey ?? 'action.failed';
  return (
    <p role="alert" className="text-body text-error">
      {translateDynamic(messages, key)}
      {outcome.correlationId ? (
        <>
          {' '}
          <span className="text-caption text-text-muted">
            {translate(messages, 'state.correlationId')}{' '}
            <code className="font-mono" dir="ltr">
              {outcome.correlationId}
            </code>
          </span>
        </>
      ) : null}
    </p>
  );
}

/** A `dt`/`dd` pair for a read-only figure. */
export function Figure({
  label,
  wide,
  children,
}: {
  readonly label: string;
  readonly wide?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="text-body text-text-primary">{children}</dd>
    </div>
  );
}
