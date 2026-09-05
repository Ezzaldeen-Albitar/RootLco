'use client';

import { useEffect, useState } from 'react';

import { SelectField, TextField } from '@/components/forms/Field';
import type { BranchOption } from '@/features/services/services-contract';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';

import { listBranches } from '../api';
import type { LocationType, ReservationState } from '../inventory-contract';

/**
 * Pieces the inventory screen shares (P1-30, `W4`).
 *
 * A branch is a pair of identifiers the backend re-authorizes as the target of
 * every stock read; it is offered as a list when the operator may read one and
 * as identifier fields when they may not. Quantities are decimal strings and
 * are rendered as such.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PRIMARY_BUTTON =
  'rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover';
export const SECONDARY_BUTTON =
  'rounded-md border border-border bg-surface px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard';

export interface Branches {
  readonly items: readonly BranchOption[] | null;
  readonly refused: string | null;
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
      else setRefused('inventory.common.branchesRefused');
    });
    return () => {
      live = false;
    };
  }, [canRead]);
  return { items, refused, offered: canRead };
}

export interface BranchPair {
  readonly companyId: string;
  readonly branchId: string;
}
export const EMPTY_PAIR: BranchPair = { companyId: '', branchId: '' };

/** A branch as a list when it may be read — choosing one fills its company — else two identifier fields. */
export function BranchPairPicker({
  messages,
  branches,
  label,
  placeholder,
  value,
  onChange,
  errors,
}: {
  readonly messages: Messages;
  readonly branches: Branches;
  readonly label: string;
  readonly placeholder: string;
  readonly value: BranchPair;
  readonly onChange: (next: BranchPair) => void;
  readonly errors?: Readonly<Record<string, string | undefined>>;
}) {
  if (branches.offered && branches.items !== null) {
    return (
      <SelectField
        label={label}
        required
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
        label={translate(messages, 'inventory.common.companyIdField')}
        description={
          branches.refused
            ? translateDynamic(messages, branches.refused)
            : translate(messages, 'inventory.common.identifierHelp')
        }
        required
        spellCheck={false}
        dir="ltr"
        value={value.companyId}
        onChange={(event) => onChange({ ...value, companyId: event.target.value })}
        error={errors?.['companyId']}
      />
      <TextField
        label={translate(messages, 'inventory.common.branchIdField')}
        required
        spellCheck={false}
        dir="ltr"
        value={value.branchId}
        onChange={(event) => onChange({ ...value, branchId: event.target.value })}
        error={errors?.['branchId']}
      />
    </>
  );
}

/** A decimal quantity string, as the server stated it. */
export function Qty({ value }: { readonly value: string }) {
  return (
    <code className="font-mono" dir="ltr">
      {value}
    </code>
  );
}

export function ReservationStatusBadge({
  messages,
  status,
}: {
  readonly messages: Messages;
  readonly status: ReservationState;
}) {
  const label = translateDynamic(messages, `inventory.reservationStatus.${status}`);
  if (status === 'active') {
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

export function LocationTypeLabel({
  messages,
  type,
}: {
  readonly messages: Messages;
  readonly type: LocationType;
}) {
  return <span>{translateDynamic(messages, `inventory.locationType.${type}`)}</span>;
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
