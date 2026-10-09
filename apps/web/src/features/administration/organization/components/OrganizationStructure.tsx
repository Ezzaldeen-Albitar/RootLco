'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { ReasonDialog } from '@/components/dialogs/ReasonDialog';
import type { FormSelectOption } from '@/components/forms/mui/FormSelectField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiEmptyState } from '@/components/states/MuiStates';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import {
  formatMessage,
  translate,
  translateDynamic,
  translateWithValues,
} from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { currencyLabel, intlLocale, timeZoneLabel } from '@/lib/format';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { changeBranchStatusAction, setCompanyStatusAction } from '../actions';
import { readBranchStatus } from '../api';
import {
  isCapacityFull,
  type BranchView,
  type CapacityAllowance,
  type CapacityKind,
  type CapacityView,
  type CompanyView,
  type ReferenceValues,
} from '../types';
import { OrgReadBoundary } from './OrgReadBoundary';
import {
  AddBranchDialog,
  AddCompanyDialog,
  EditBranchDialog,
  EditCompanyDialog,
} from './StructureDialogs';
import { useSingleFlight } from './use-single-flight';

/**
 * Companies and branches, on the Organization screen — on Material UI
 * (ADR-022, P1-32-PRE-OD-ADM1).
 *
 * ## Which controls appear
 *
 * Each control is shown only to a session holding the code its operation
 * declares: Add company, Edit company and a company's status change take
 * `org.company.manage`; Add branch and Edit branch take `org.branch.manage`;
 * and a branch's status change takes `org.settings.manage`. The visibility is
 * courtesy — the server checks every request against the record's own company
 * and branch, and its refusal is the one that counts.
 *
 * ## The lists are Material's table
 *
 * `org.company-list` and `org.branch-list` each answer one bounded list with no
 * cursor and no "more exist" flag, so there is nothing for the operational
 * grid's pager to walk (planner ruling of 2026-10-09). A list that reached the
 * service's ceiling is not said to be cut short, because the read does not say
 * so; that is recorded as a known limitation in the route checklist.
 *
 * ## A full allowance keeps its button
 *
 * The explanation appears beside the button instead of the button disappearing.
 * A hidden button reads as "you may not", which is the wrong reason, and a seat
 * may have been released since the page was read.
 *
 * ## Versions
 *
 * Editing sends the version each list publishes beside its row
 * (`StructureDialogs.tsx`). The branch status transition reads the branch's
 * current version from its own status read at the moment the operator confirms,
 * as before — it is not a form the operator edits, so there is nothing typed for
 * a stale version to protect.
 *
 * ## Currency and time zone are chosen, never typed (P1-32-PRE-OD-REF)
 *
 * The base currency offers the codes enabled for the organisation's companies
 * (`currency.enabled_codes`) when there are any, and otherwise the active
 * currencies of `org.reference-values-read`. The branch time zone offers the
 * active zones of that read, and falls back to the zones the tenant and its
 * branches already use when the read was not permitted or failed. Neither ever
 * falls back to free text. A currency reads as its name in the reader's
 * language with its code beside it, a zone as its generic name with its
 * identifier (P1-32-PRE-OD-QAF).
 */

type StatusTarget =
  | { readonly kind: 'company'; readonly company: CompanyView }
  | { readonly kind: 'branch'; readonly branch: BranchView };

type OpenDialog =
  | { readonly kind: 'add-company' }
  | { readonly kind: 'add-branch' }
  | { readonly kind: 'edit-company'; readonly id: string }
  | { readonly kind: 'edit-branch'; readonly id: string };

export function OrganizationStructure({
  locale,
  messages,
  capacity,
  companies,
  branches,
  currencyChoices,
  timezoneChoices,
  referenceValues,
  referenceUnavailable = false,
  canManageCompanies,
  canManageBranches,
  canChangeBranchStatus,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly capacity: CapacityView | null;
  readonly companies: ReadState<readonly CompanyView[]> | null;
  readonly branches: ReadState<readonly BranchView[]> | null;
  /** The codes enabled in `currency.enabled_codes` for the companies this session reaches. */
  readonly currencyChoices: readonly string[];
  /** The zones the tenant and its branches already use. */
  readonly timezoneChoices: readonly string[];
  /** `org.reference-values-read`; `null` when it was not permitted or failed. */
  readonly referenceValues: ReferenceValues | null;
  /** The reference read was made and failed, so the dialogs offer Try again. */
  readonly referenceUnavailable?: boolean;
  readonly canManageCompanies: boolean;
  readonly canManageBranches: boolean;
  readonly canChangeBranchStatus: boolean;
}) {
  const router = useRouter();
  const t = (key: string) => translate(messages, key as keyof Messages);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [target, setTarget] = useState<StatusTarget | null>(null);
  const [failure, setFailure] = useState<ActionState>(IDLE);
  const statusFlight = useSingleFlight();
  const attempts = useRef(0);

  const companyRows = companies?.status === 'ok' ? companies.data : [];
  const branchRows = branches?.status === 'ok' ? branches.data : [];
  const collator = new Intl.Collator(intlLocale(locale));
  const registerName = new Map(
    (referenceValues?.currencies ?? []).map((currency) => [currency.code, currency.name])
  );
  const currencyCodes =
    currencyChoices.length > 0
      ? currencyChoices
      : (referenceValues?.currencies ?? []).map((currency) => currency.code);
  const currencyOptions: readonly FormSelectOption[] = currencyCodes
    .map((code) => ({ value: code, label: currencyLabel(code, locale, registerName.get(code)) }))
    .sort((a, b) => collator.compare(a.label, b.label));
  // A reference list with no active zone falls back to the zones in use, the
  // same as a list that could not be loaded.
  const referenceZones = (referenceValues?.timezones ?? []).map((zone) => zone.zoneName);
  const timezoneFromFallback = referenceZones.length === 0;
  const timezoneOptions: readonly FormSelectOption[] = (
    timezoneFromFallback ? timezoneChoices : referenceZones
  ).map((zone) => ({ value: zone, label: timeZoneLabel(zone, locale) }));
  const timezonePartial = timezoneFromFallback && referenceUnavailable;
  const timezoneHint =
    timezoneOptions.length === 0
      ? referenceUnavailable
        ? 'form.referenceList.unavailable'
        : 'organization.branch.timezoneUnavailable'
      : timezonePartial
        ? 'form.referenceList.partial'
        : 'organization.branch.timezoneHint';
  // With neither source holding a currency the select has nothing to offer, and
  // the dialog says so rather than presenting an empty required choice.
  const currencyHint =
    currencyChoices.length > 0
      ? 'organization.company.baseCurrencyHint'
      : currencyOptions.length > 0
        ? 'organization.company.currencyHint'
        : referenceUnavailable
          ? 'form.referenceList.unavailable'
          : 'organization.company.currencyUnavailable';
  const companyName = new Map(companyRows.map((company) => [company.id, company.legalName]));

  const confirmStatus = (reason: string) => {
    if (!target) return;
    const chosen = target;
    statusFlight.run(async () => {
      let result: ActionState;
      if (chosen.kind === 'company') {
        const next = chosen.company.status === 'active' ? 'inactive' : 'active';
        result = await setCompanyStatusAction(chosen.company.id, next, reason);
      } else {
        const next = chosen.branch.status === 'active' ? 'inactive' : 'active';
        const current = await readBranchStatus(chosen.branch.id);
        result =
          current.status === 'ok' && current.data !== null
            ? await changeBranchStatusAction(
                chosen.branch.id,
                next,
                reason,
                current.data.recordVersion
              )
            : {
                status: current.status === 'denied' ? 'denied' : 'error',
                messageKey:
                  current.status === 'denied' ? 'state.denied.title' : 'admin.actionFailed',
                correlationId: current.correlationId,
                attempt: 1,
              };
      }
      attempts.current += 1;
      setFailure({ ...result, attempt: attempts.current });
      notifyActionResult(result, messages);
      if (result.status === 'success') {
        setTarget(null);
        router.refresh();
      }
    });
  };

  const statusVerb = (status: string) =>
    status === 'active' ? 'organization.structure.deactivate' : 'organization.structure.activate';
  const closeDialog = () => {
    setDialog(null);
    router.refresh();
  };
  const editingCompany =
    dialog?.kind === 'edit-company' ? companyRows.find((row) => row.id === dialog.id) : undefined;
  const editingBranch =
    dialog?.kind === 'edit-branch' ? branchRows.find((row) => row.id === dialog.id) : undefined;
  const branchActions = canManageBranches || canChangeBranchStatus;

  return (
    <div className="flex flex-col gap-6">
      {companies ? (
        <section aria-labelledby="org-companies" className="flex flex-col gap-3">
          <SectionHeading
            id="org-companies"
            title={t('organization.company.title')}
            description={t('organization.company.description')}
            action={
              canManageCompanies ? (
                <Button variant="contained" onClick={() => setDialog({ kind: 'add-company' })}>
                  {t('organization.company.add')}
                </Button>
              ) : null
            }
          />
          {canManageCompanies ? (
            <CapacityNotice
              kind="companies"
              allowance={capacity?.capacity.companies}
              messages={messages}
            />
          ) : null}
          <OrgReadBoundary state={companies} messages={messages} locale={locale}>
            {(rows) =>
              rows.length === 0 ? (
                <MuiEmptyState
                  messages={messages}
                  titleKey="organization.company.emptyTitle"
                  descriptionKey="organization.company.emptyBody"
                />
              ) : (
                <TableContainer className="rounded-lg border border-border-subtle">
                  <Table size="small" aria-labelledby="org-companies">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('organization.structure.code')}</TableCell>
                        <TableCell>{t('organization.company.legalName')}</TableCell>
                        <TableCell>{t('organization.status')}</TableCell>
                        {canManageCompanies ? <TableCell>{t('admin.actions')}</TableCell> : null}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.map((company) => (
                        <TableRow key={company.id}>
                          <TableCell className="font-mono text-caption">
                            <span dir="ltr">{company.companyCode}</span>
                          </TableCell>
                          <TableCell>{company.legalName}</TableCell>
                          <TableCell>
                            <StatusChip status={company.status} messages={messages} />
                          </TableCell>
                          {canManageCompanies ? (
                            <TableCell>
                              <div className="flex flex-nowrap gap-2">
                                <Button
                                  size="small"
                                  variant="outlined"
                                  aria-label={`${t('admin.edit')}: ${company.legalName}`}
                                  onClick={() =>
                                    setDialog({ kind: 'edit-company', id: company.id })
                                  }
                                >
                                  {t('admin.edit')}
                                </Button>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  aria-label={`${t(statusVerb(company.status))}: ${company.legalName}`}
                                  onClick={() => {
                                    setFailure(IDLE);
                                    setTarget({ kind: 'company', company });
                                  }}
                                >
                                  {t(statusVerb(company.status))}
                                </Button>
                              </div>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )
            }
          </OrgReadBoundary>
        </section>
      ) : null}

      {branches ? (
        <section aria-labelledby="org-branches" className="flex flex-col gap-3">
          <SectionHeading
            id="org-branches"
            title={t('organization.branch.title')}
            description={t('organization.branch.description')}
            action={
              canManageBranches ? (
                <Button variant="contained" onClick={() => setDialog({ kind: 'add-branch' })}>
                  {t('organization.branch.add')}
                </Button>
              ) : null
            }
          />
          {canManageBranches ? (
            <CapacityNotice
              kind="branches"
              allowance={capacity?.capacity.branches}
              messages={messages}
            />
          ) : null}
          <OrgReadBoundary state={branches} messages={messages} locale={locale}>
            {(rows) =>
              rows.length === 0 ? (
                <MuiEmptyState
                  messages={messages}
                  titleKey="organization.branch.emptyTitle"
                  descriptionKey="organization.branch.emptyBody"
                />
              ) : (
                <TableContainer className="rounded-lg border border-border-subtle">
                  <Table size="small" aria-labelledby="org-branches">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('organization.structure.code')}</TableCell>
                        <TableCell>{t('organization.branch.name')}</TableCell>
                        <TableCell>{t('organization.branch.company')}</TableCell>
                        <TableCell>{t('organization.branch.city')}</TableCell>
                        <TableCell>{t('organization.branch.timezone')}</TableCell>
                        <TableCell>{t('organization.status')}</TableCell>
                        {branchActions ? <TableCell>{t('admin.actions')}</TableCell> : null}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.map((branch) => (
                        <TableRow key={branch.id}>
                          <TableCell className="font-mono text-caption">
                            <span dir="ltr">{branch.branchCode}</span>
                          </TableCell>
                          <TableCell>{branch.name}</TableCell>
                          <TableCell>{companyName.get(branch.companyId) ?? '—'}</TableCell>
                          <TableCell>{placeOf(branch, locale)}</TableCell>
                          <TableCell>{timeZoneLabel(branch.timezoneName, locale)}</TableCell>
                          <TableCell>
                            <StatusChip status={branch.status} messages={messages} />
                          </TableCell>
                          {branchActions ? (
                            <TableCell>
                              <div className="flex flex-nowrap gap-2">
                                {canManageBranches ? (
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    aria-label={`${t('admin.edit')}: ${branch.name}`}
                                    onClick={() =>
                                      setDialog({ kind: 'edit-branch', id: branch.id })
                                    }
                                  >
                                    {t('admin.edit')}
                                  </Button>
                                ) : null}
                                {canChangeBranchStatus ? (
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    aria-label={`${t(statusVerb(branch.status))}: ${branch.name}`}
                                    onClick={() => {
                                      setFailure(IDLE);
                                      setTarget({ kind: 'branch', branch });
                                    }}
                                  >
                                    {t(statusVerb(branch.status))}
                                  </Button>
                                ) : null}
                              </div>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )
            }
          </OrgReadBoundary>
        </section>
      ) : null}

      {dialog?.kind === 'add-company' ? (
        <AddCompanyDialog
          messages={messages}
          currencyChoices={currencyOptions}
          currencyHint={currencyHint}
          offerRetry={currencyOptions.length === 0}
          onClose={closeDialog}
        />
      ) : null}

      {dialog?.kind === 'add-branch' ? (
        <AddBranchDialog
          messages={messages}
          companies={companyRows}
          timezoneChoices={timezoneOptions}
          timezoneHint={timezoneHint}
          offerRetry={timezoneOptions.length === 0 || timezonePartial}
          onClose={closeDialog}
        />
      ) : null}

      {editingCompany ? (
        <EditCompanyDialog
          messages={messages}
          company={editingCompany}
          onClose={() => setDialog(null)}
          onSaved={closeDialog}
        />
      ) : null}

      {editingBranch ? (
        <EditBranchDialog
          messages={messages}
          branch={editingBranch}
          timezoneChoices={
            timezoneOptions.some((option) => option.value === editingBranch.timezoneName)
              ? timezoneOptions
              : [
                  {
                    value: editingBranch.timezoneName,
                    label: timeZoneLabel(editingBranch.timezoneName, locale),
                  },
                  ...timezoneOptions,
                ]
          }
          timezoneHint={
            timezonePartial ? 'form.referenceList.partial' : 'organization.branch.timezoneHint'
          }
          offerRetry={timezonePartial}
          onClose={() => setDialog(null)}
          onSaved={closeDialog}
        />
      ) : null}

      <ReasonDialog
        open={target !== null}
        messages={messages}
        destructive={
          target !== null &&
          (target.kind === 'company' ? target.company.status : target.branch.status) === 'active'
        }
        pending={statusFlight.pending}
        title={
          target === null
            ? ''
            : t(
                target.kind === 'company'
                  ? target.company.status === 'active'
                    ? 'organization.company.confirmDeactivate'
                    : 'organization.company.confirmActivate'
                  : target.branch.status === 'active'
                    ? 'organization.branch.confirmDeactivate'
                    : 'organization.branch.confirmActivate'
              )
        }
        description={
          target === null
            ? undefined
            : target.kind === 'company'
              ? target.company.legalName
              : target.branch.name
        }
        confirmLabel={
          target === null
            ? ''
            : t(
                statusVerb(target.kind === 'company' ? target.company.status : target.branch.status)
              )
        }
        reasonLabel={t('admin.reason')}
        reasonError={failure.fieldErrors?.['reason'] ? t(failure.fieldErrors['reason']) : undefined}
        error={
          failure.status !== 'idle' &&
          failure.status !== 'success' &&
          !failure.fieldErrors?.['reason']
            ? translateWithValues(
                messages,
                failure.messageKey ?? 'admin.actionFailed',
                failure.messageValues
              )
            : undefined
        }
        onCancel={() => setTarget(null)}
        onConfirm={confirmStatus}
      />
    </div>
  );
}

function SectionHeading({
  id,
  title,
  description,
  action,
}: {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly action: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="text-section-title font-semibold text-text-heading">
          {title}
        </h2>
        <p className="mt-1 text-supporting text-text-secondary">{description}</p>
      </div>
      {action}
    </div>
  );
}

/** `active` or `inactive`, in words; anything else is shown as inactive. */
function StatusChip({
  status,
  messages,
}: {
  readonly status: string;
  readonly messages: Messages;
}) {
  const active = status === 'active';
  return (
    <Chip
      size="small"
      variant="outlined"
      color={active ? 'success' : 'default'}
      label={translate(
        messages,
        active ? 'organization.structure.status.active' : 'organization.structure.status.inactive'
      )}
    />
  );
}

/**
 * The explanation shown beside an Add button when the allowance is spent. The
 * button stays: the server is the enforcement, and a seat may have been
 * released a moment ago.
 */
function CapacityNotice({
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
    <Alert severity="warning" role="note" variant="outlined">
      {formatMessage(translateDynamic(messages, `capacity.reached.${kind}`), {
        limit: String(allowance.limit),
        used: String(allowance.used),
      })}
    </Alert>
  );
}

/** "Amman, Jordan": the city and the country's name in the reader's language. */
function placeOf(branch: BranchView, locale: Locale): string {
  const country = branch.countryCode ? countryName(branch.countryCode, locale) : null;
  return [branch.city, country].filter(Boolean).join(', ') || '—';
}

function countryName(code: string, locale: Locale): string {
  try {
    return (
      new Intl.DisplayNames([intlLocale(locale)], { type: 'region', fallback: 'code' }).of(code) ??
      code
    );
  } catch {
    return code;
  }
}
