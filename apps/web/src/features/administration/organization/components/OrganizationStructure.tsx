'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SelectField, TextField } from '@/components/forms/Field';
import { Dialog, ReasonConfirmDialog } from '@/components/overlays/Overlays';
import { EmptyState } from '@/components/states/States';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateWithValues } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import { SubmitButton } from '@/features/authentication/components/SubmitButton';
import { ReadBoundary } from '../../shared/components/ScreenStates';
import {
  CapacityNotice,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  StatusPill,
  TableFrame,
  Th,
} from '../../shared/components/StructureParts';
import {
  changeBranchStatusAction,
  createBranchAction,
  createCompanyAction,
  setCompanyStatusAction,
} from '../actions';
import { readBranchStatus } from '../api';
import type { BranchView, CapacityView, CompanyView } from '../types';

/**
 * Companies and branches, on the Organization screen.
 *
 * ## Which controls appear
 *
 * Each control is shown only to a session holding the code its operation
 * declares: Add company and a company's status change take
 * `org.company.manage`, Add branch takes `org.branch.manage`, and a branch's
 * status change takes `org.settings.manage`. The visibility is courtesy — the
 * server checks every request and its refusal is the one that counts.
 *
 * ## A full allowance keeps its button
 *
 * The explanation appears beside the button instead of the button disappearing.
 * A hidden button reads as "you may not", which is the wrong reason, and a seat
 * may have been released since the page was read.
 *
 * ## The branch status needs the branch's current version
 *
 * The transition is version-guarded and the branch list publishes no version,
 * so the version is read from the branch's own status read at the moment the
 * operator confirms — never remembered from an earlier page read, and never
 * guessed.
 */

type StatusTarget =
  | { readonly kind: 'company'; readonly company: CompanyView }
  | { readonly kind: 'branch'; readonly branch: BranchView };

export function OrganizationStructure({
  messages,
  capacity,
  companies,
  branches,
  currencyChoices,
  timezoneChoices,
  canManageCompanies,
  canManageBranches,
  canChangeBranchStatus,
}: {
  readonly messages: Messages;
  readonly capacity: CapacityView | null;
  readonly companies: ReadState<readonly CompanyView[]> | null;
  readonly branches: ReadState<readonly BranchView[]> | null;
  readonly currencyChoices: readonly string[];
  readonly timezoneChoices: readonly string[];
  readonly canManageCompanies: boolean;
  readonly canManageBranches: boolean;
  readonly canChangeBranchStatus: boolean;
}) {
  const router = useRouter();
  const t = (key: string) => translate(messages, key as keyof Messages);
  const [dialog, setDialog] = useState<'company' | 'branch' | null>(null);
  const [target, setTarget] = useState<StatusTarget | null>(null);
  const [failure, setFailure] = useState<ActionState>(IDLE);
  const [running, startTransition] = useTransition();

  const companyRows = companies?.status === 'ok' ? companies.data : [];
  const companyName = new Map(companyRows.map((company) => [company.id, company.legalName]));

  const confirmStatus = (reason: string) => {
    if (!target) return;
    startTransition(async () => {
      let result: ActionState;
      if (target.kind === 'company') {
        const next = target.company.status === 'active' ? 'inactive' : 'active';
        result = await setCompanyStatusAction(target.company.id, next, reason);
      } else {
        const next = target.branch.status === 'active' ? 'inactive' : 'active';
        const current = await readBranchStatus(target.branch.id);
        result =
          current.status === 'ok' && current.data !== null
            ? await changeBranchStatusAction(
                target.branch.id,
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
      setFailure({ ...result, attempt: (failure.attempt ?? 0) + 1 });
      notifyActionResult(result, messages);
      if (result.status === 'success') {
        setTarget(null);
        router.refresh();
      }
    });
  };

  const statusVerb = (status: string) =>
    status === 'active' ? 'organization.structure.deactivate' : 'organization.structure.activate';

  return (
    <div className="flex flex-col gap-6">
      {companies ? (
        <section aria-labelledby="org-companies" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="org-companies" className="text-section-title font-semibold text-text-heading">
                {t('organization.company.title')}
              </h2>
              <p className="mt-1 text-supporting text-text-secondary">
                {t('organization.company.description')}
              </p>
            </div>
            {canManageCompanies ? (
              <button type="button" className={PRIMARY_BUTTON} onClick={() => setDialog('company')}>
                {t('organization.company.add')}
              </button>
            ) : null}
          </div>
          {canManageCompanies ? (
            <CapacityNotice
              kind="companies"
              allowance={capacity?.capacity.companies}
              messages={messages}
            />
          ) : null}
          <ReadBoundary state={companies} messages={messages}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState
                  messages={messages}
                  titleKey="organization.company.emptyTitle"
                  descriptionKey="organization.company.emptyBody"
                />
              ) : (
                <TableFrame caption={t('organization.company.title')}>
                  <thead className="border-b border-table-border bg-table-header">
                    <tr>
                      <Th>{t('organization.structure.code')}</Th>
                      <Th>{t('organization.company.legalName')}</Th>
                      <Th>{t('organization.status')}</Th>
                      {canManageCompanies ? <Th>{t('admin.actions')}</Th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((company) => (
                      <tr key={company.id} className="border-t border-border-subtle">
                        <td className="px-3 py-2 font-mono text-caption text-text-secondary">
                          {company.companyCode}
                        </td>
                        <td className="px-3 py-2 text-text-primary">{company.legalName}</td>
                        <td className="px-3 py-2">
                          <StatusPill status={company.status} messages={messages} />
                        </td>
                        {canManageCompanies ? (
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className={SECONDARY_BUTTON}
                              aria-label={`${t(statusVerb(company.status))}: ${company.legalName}`}
                              onClick={() => {
                                setFailure(IDLE);
                                setTarget({ kind: 'company', company });
                              }}
                            >
                              {t(statusVerb(company.status))}
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </TableFrame>
              )
            }
          </ReadBoundary>
        </section>
      ) : null}

      {branches ? (
        <section aria-labelledby="org-branches" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="org-branches" className="text-section-title font-semibold text-text-heading">
                {t('organization.branch.title')}
              </h2>
              <p className="mt-1 text-supporting text-text-secondary">
                {t('organization.branch.description')}
              </p>
            </div>
            {canManageBranches ? (
              <button type="button" className={PRIMARY_BUTTON} onClick={() => setDialog('branch')}>
                {t('organization.branch.add')}
              </button>
            ) : null}
          </div>
          {canManageBranches ? (
            <CapacityNotice
              kind="branches"
              allowance={capacity?.capacity.branches}
              messages={messages}
            />
          ) : null}
          <ReadBoundary state={branches} messages={messages}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState
                  messages={messages}
                  titleKey="organization.branch.emptyTitle"
                  descriptionKey="organization.branch.emptyBody"
                />
              ) : (
                <TableFrame caption={t('organization.branch.title')}>
                  <thead className="border-b border-table-border bg-table-header">
                    <tr>
                      <Th>{t('organization.structure.code')}</Th>
                      <Th>{t('organization.branch.name')}</Th>
                      <Th>{t('organization.branch.company')}</Th>
                      <Th>{t('organization.branch.city')}</Th>
                      <Th>{t('organization.branch.timezone')}</Th>
                      <Th>{t('organization.status')}</Th>
                      {canChangeBranchStatus ? <Th>{t('admin.actions')}</Th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((branch) => (
                      <tr key={branch.id} className="border-t border-border-subtle">
                        <td className="px-3 py-2 font-mono text-caption text-text-secondary">
                          {branch.branchCode}
                        </td>
                        <td className="px-3 py-2 text-text-primary">{branch.name}</td>
                        <td className="px-3 py-2 text-text-secondary">
                          {companyName.get(branch.companyId) ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-text-secondary">
                          {[branch.city, branch.countryCode].filter(Boolean).join(', ') || '—'}
                        </td>
                        <td className="px-3 py-2 text-text-secondary">{branch.timezoneName}</td>
                        <td className="px-3 py-2">
                          <StatusPill status={branch.status} messages={messages} />
                        </td>
                        {canChangeBranchStatus ? (
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className={SECONDARY_BUTTON}
                              aria-label={`${t(statusVerb(branch.status))}: ${branch.name}`}
                              onClick={() => {
                                setFailure(IDLE);
                                setTarget({ kind: 'branch', branch });
                              }}
                            >
                              {t(statusVerb(branch.status))}
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </TableFrame>
              )
            }
          </ReadBoundary>
        </section>
      ) : null}

      {dialog === 'company' ? (
        <CompanyDialog
          messages={messages}
          currencyChoices={currencyChoices}
          onClose={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      ) : null}

      {dialog === 'branch' ? (
        <BranchDialog
          messages={messages}
          companies={companyRows}
          timezoneChoices={timezoneChoices}
          onClose={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      ) : null}

      {target ? (
        <ReasonConfirmDialog
          open
          messages={messages}
          destructive={
            (target.kind === 'company' ? target.company.status : target.branch.status) === 'active'
          }
          pending={running}
          title={t(
            target.kind === 'company'
              ? target.company.status === 'active'
                ? 'organization.company.confirmDeactivate'
                : 'organization.company.confirmActivate'
              : target.branch.status === 'active'
                ? 'organization.branch.confirmDeactivate'
                : 'organization.branch.confirmActivate'
          )}
          description={target.kind === 'company' ? target.company.legalName : target.branch.name}
          confirmLabel={t(
            statusVerb(target.kind === 'company' ? target.company.status : target.branch.status)
          )}
          reasonLabel={t('admin.reason')}
          error={
            failure.status !== 'idle' && failure.status !== 'success'
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
      ) : null}
    </div>
  );
}

/**
 * Add company.
 *
 * Mounted only while open, so a second company starts from an empty form. It
 * does not close itself on success: the confirmation stays until the operator
 * closes it, and closing re-reads the page.
 */
function CompanyDialog({
  messages,
  currencyChoices,
  onClose,
}: {
  readonly messages: Messages;
  readonly currencyChoices: readonly string[];
  readonly onClose: () => void;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(createCompanyAction, IDLE);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const t = (key: string) => translate(messages, key as keyof Messages);
  const retain = (name: string) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [name]: event.target.value }));
  const fieldError = (name: string) =>
    state.fieldErrors?.[name] ? t(state.fieldErrors[name]) : undefined;

  return (
    <Dialog
      open
      onClose={onClose}
      messages={messages}
      title={t('organization.company.add')}
      description={t('organization.company.addDescription')}
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <FormFeedback state={state} messages={messages} />
        <TextField
          key={`code-${state.attempt ?? 0}`}
          name="code"
          onChange={retain('code')}
          error={fieldError('code')}
          defaultValue={draft['code'] ?? ''}
          label={t('organization.structure.code')}
          description={t('organization.structure.codeHint')}
          required
          autoComplete="off"
          spellCheck={false}
        />
        <TextField
          key={`legalName-${state.attempt ?? 0}`}
          name="legalName"
          onChange={retain('legalName')}
          error={fieldError('legalName')}
          defaultValue={draft['legalName'] ?? ''}
          label={t('organization.company.legalName')}
          required
          autoComplete="off"
        />
        {currencyChoices.length > 0 ? (
          <SelectField
            key={`baseCurrency-${state.attempt ?? 0}`}
            name="baseCurrency"
            onChange={retain('baseCurrency')}
            error={fieldError('baseCurrency')}
            defaultValue={draft['baseCurrency'] ?? ''}
            label={t('organization.company.baseCurrency')}
            description={t('organization.company.baseCurrencyHint')}
            required
            placeholder={t('field.selectPlaceholder')}
            options={currencyChoices.map((code) => ({ value: code, label: code }))}
          />
        ) : (
          <TextField
            key={`baseCurrency-${state.attempt ?? 0}`}
            name="baseCurrency"
            onChange={retain('baseCurrency')}
            error={fieldError('baseCurrency')}
            defaultValue={draft['baseCurrency'] ?? ''}
            label={t('organization.company.baseCurrency')}
            description={t('organization.company.currencyHint')}
            required
            autoComplete="off"
            spellCheck={false}
            maxLength={3}
          />
        )}
        <TextField
          key={`registrationNumber-${state.attempt ?? 0}`}
          name="registrationNumber"
          onChange={retain('registrationNumber')}
          error={fieldError('registrationNumber')}
          defaultValue={draft['registrationNumber'] ?? ''}
          label={t('organization.company.registrationNumber')}
          optionalHint={t('field.optional')}
          autoComplete="off"
        />
        <TextField
          key={`taxRegistrationNumber-${state.attempt ?? 0}`}
          name="taxRegistrationNumber"
          onChange={retain('taxRegistrationNumber')}
          error={fieldError('taxRegistrationNumber')}
          defaultValue={draft['taxRegistrationNumber'] ?? ''}
          label={t('organization.company.taxRegistrationNumber')}
          optionalHint={t('field.optional')}
          autoComplete="off"
        />
        <DialogActions state={state} messages={messages} onClose={onClose} />
      </form>
    </Dialog>
  );
}

/** Add branch. Same lifecycle as Add company. */
function BranchDialog({
  messages,
  companies,
  timezoneChoices,
  onClose,
}: {
  readonly messages: Messages;
  readonly companies: readonly CompanyView[];
  readonly timezoneChoices: readonly string[];
  readonly onClose: () => void;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(createBranchAction, IDLE);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const t = (key: string) => translate(messages, key as keyof Messages);
  const retain = (name: string) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [name]: event.target.value }));
  const fieldError = (name: string) =>
    state.fieldErrors?.[name] ? t(state.fieldErrors[name]) : undefined;

  return (
    <Dialog
      open
      onClose={onClose}
      messages={messages}
      title={t('organization.branch.add')}
      description={t('organization.branch.addDescription')}
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <FormFeedback state={state} messages={messages} />
        <SelectField
          key={`companyId-${state.attempt ?? 0}`}
          name="companyId"
          onChange={retain('companyId')}
          error={fieldError('companyId')}
          defaultValue={draft['companyId'] ?? ''}
          label={t('organization.branch.company')}
          required
          placeholder={t('admin.scope.pickCompany')}
          options={companies.map((company) => ({ value: company.id, label: company.legalName }))}
        />
        <TextField
          key={`code-${state.attempt ?? 0}`}
          name="code"
          onChange={retain('code')}
          error={fieldError('code')}
          defaultValue={draft['code'] ?? ''}
          label={t('organization.structure.code')}
          description={t('organization.structure.codeHint')}
          required
          autoComplete="off"
          spellCheck={false}
        />
        <TextField
          key={`name-${state.attempt ?? 0}`}
          name="name"
          onChange={retain('name')}
          error={fieldError('name')}
          defaultValue={draft['name'] ?? ''}
          label={t('organization.branch.name')}
          required
          autoComplete="off"
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextField
            key={`city-${state.attempt ?? 0}`}
            name="city"
            onChange={retain('city')}
            error={fieldError('city')}
            defaultValue={draft['city'] ?? ''}
            label={t('organization.branch.city')}
            optionalHint={t('field.optional')}
            autoComplete="off"
          />
          <TextField
            key={`countryCode-${state.attempt ?? 0}`}
            name="countryCode"
            onChange={retain('countryCode')}
            error={fieldError('countryCode')}
            defaultValue={draft['countryCode'] ?? ''}
            label={t('organization.branch.country')}
            description={t('organization.branch.countryHint')}
            optionalHint={t('field.optional')}
            autoComplete="off"
            maxLength={2}
          />
        </div>
        <TextField
          key={`timezone-${state.attempt ?? 0}`}
          name="timezone"
          onChange={retain('timezone')}
          error={fieldError('timezone')}
          defaultValue={draft['timezone'] ?? ''}
          label={t('organization.branch.timezone')}
          description={t('organization.branch.timezoneHint')}
          required
          autoComplete="off"
          spellCheck={false}
          list="branch-timezone-choices"
        />
        <datalist id="branch-timezone-choices">
          {timezoneChoices.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
        <DialogActions state={state} messages={messages} onClose={onClose} />
      </form>
    </Dialog>
  );
}

function DialogActions({
  state,
  messages,
  onClose,
}: {
  readonly state: ActionState;
  readonly messages: Messages;
  readonly onClose: () => void;
}) {
  const t = (key: string) => translate(messages, key as keyof Messages);
  return (
    <div className="flex justify-end gap-2">
      {state.status === 'success' ? (
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border bg-surface px-4 py-2 text-button text-text-secondary hover:bg-surface-subtle"
        >
          {t('admin.close')}
        </button>
      ) : (
        <SubmitButton label={t('admin.create')} pendingLabel={t('admin.creating')} full={false} />
      )}
    </div>
  );
}
