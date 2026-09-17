import type { ReactNode } from 'react';
import { SelectField } from '@/components/forms/Field';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import {
  isCapacityFull,
  type BranchView,
  type CapacityAllowance,
  type CapacityKind,
  type CompanyView,
} from '../../organization/types';

/**
 * The small pieces the organisation-structure screens share: the companies and
 * branches on the Organization screen, Departments, Employees and a user's
 * access. One definition of a primary button and a status pill, so four screens
 * cannot drift into four slightly different ones.
 */

export const PRIMARY_BUTTON =
  'rounded-lg bg-primary px-4 py-2 text-button font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-70';

export const SECONDARY_BUTTON =
  'rounded-md border border-border bg-surface px-2 py-1 text-caption text-text-secondary transition-colors duration-fast ease-standard hover:bg-surface-subtle hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

export function Th({ children }: { readonly children: ReactNode }) {
  return (
    <th
      scope="col"
      className="px-3 py-2 text-start text-table-header font-semibold uppercase tracking-wide text-table-header-text"
    >
      {children}
    </th>
  );
}

/** A horizontally scrollable table frame, so a tablet never squeezes a column to nothing. */
export function TableFrame({
  caption,
  children,
}: {
  readonly caption: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full min-w-[36rem] border-collapse text-table-cell">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

/** `active` or `inactive`, in words. Anything else is shown as the neutral inactive tone. */
export function StatusPill({
  status,
  messages,
}: {
  readonly status: string;
  readonly messages: Messages;
}) {
  const active = status === 'active';
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-caption text-text-primary ${
        active ? 'border-success-border bg-success-subtle' : 'border-border bg-surface-subtle'
      }`}
    >
      {translate(
        messages,
        active ? 'organization.structure.status.active' : 'organization.structure.status.inactive'
      )}
    </span>
  );
}

/**
 * The explanation shown beside an Add button when the allowance is spent.
 *
 * The button stays. The server is the enforcement and a creation can still
 * succeed if a seat was released a moment ago; this only tells the operator,
 * before they fill in a form, what the answer is likely to be and who can
 * change it.
 */
export function CapacityNotice({
  kind,
  allowance,
  messages,
}: {
  readonly kind: CapacityKind;
  readonly allowance: CapacityAllowance | undefined;
  readonly messages: Messages;
}) {
  if (allowance === undefined || !isCapacityFull(allowance)) return null;
  return (
    <p
      role="note"
      className="rounded-lg border border-warning-border bg-warning-subtle p-3 text-supporting text-text-primary"
    >
      {formatMessage(translateDynamic(messages, `capacity.reached.${kind}`), {
        limit: String(allowance.limit),
        used: String(allowance.used),
      })}
    </p>
  );
}

/**
 * Chooses one branch, named under its company.
 *
 * A branch name is only unambiguous beneath its company — two companies may each
 * have a "Main Workshop" — so the company travels in the label.
 */
export function BranchPicker({
  messages,
  branches,
  companies,
  value,
  attempt,
  onChange,
}: {
  readonly messages: Messages;
  readonly branches: readonly BranchView[];
  readonly companies: readonly CompanyView[];
  readonly value: string;
  /**
   * The caller's settlement epoch. The picker is uncontrolled — a key that
   * changes with the epoch, a default from the caller's state, and a change
   * handler — so a form reset elsewhere on the screen can never revert the
   * branch the operator is looking at while the list still shows it.
   */
  readonly attempt?: number | undefined;
  readonly onChange: (branchId: string) => void;
}) {
  const companyName = new Map(companies.map((company) => [company.id, company.legalName]));
  return (
    <SelectField
      key={`branch-picker-${attempt ?? 0}`}
      label={translate(messages, 'admin.scope.branch')}
      placeholder={translate(messages, 'admin.scope.pickBranch')}
      defaultValue={value}
      onChange={(event) => onChange(event.target.value)}
      options={branches.map((branch) => ({
        value: branch.id,
        label: companyName.has(branch.companyId)
          ? `${branch.name} — ${companyName.get(branch.companyId) as string}`
          : branch.name,
      }))}
    />
  );
}
