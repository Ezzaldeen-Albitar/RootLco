'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckboxField, RadioGroupField, SelectField } from '@/components/forms/Field';
import { ConfirmDialog, Dialog, ReasonConfirmDialog } from '@/components/overlays/Overlays';
import { EmptyState, LoadingState } from '@/components/states/States';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateWithValues } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { formatDate } from '@/lib/format';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import { ReadBoundary } from '../../shared/components/ScreenStates';
import {
  BranchPicker,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  StatusPill,
} from '../../shared/components/StructureParts';
import { listDepartments } from '../../departments/api';
import type { DepartmentView } from '../../departments/types';
import type { BranchView, CompanyView } from '../../organization/types';
import {
  addGrantScopesAction,
  issueGrantAction,
  removeGrantScopeAction,
  revokeGrantAction,
} from '../actions';
import type { AccessGrant, RoleOption, UserRow } from '../api';
import { scopeSummaryKey, type GrantScopeView, type ScopeMode, type ScopeRequest } from '../types';

/**
 * One user's access: which roles they hold, and where each role applies.
 *
 * ## Where a role applies, in plain words
 *
 * A grant with no places applies across the whole organisation. A grant with
 * one branch applies in that branch only. A grant with several branches applies
 * in each of them — there is no separate "multi-branch" kind, it is simply more
 * than one place. The screen says exactly that, because the difference between
 * "one branch" and "everywhere" is the difference between a workshop supervisor
 * and a regional one.
 *
 * ## Taking a role away
 *
 * Revoking is version-guarded and needs a written reason, so it goes through a
 * reason dialog and sends the version the screen displayed. Two refusals come
 * from the server and are not pre-empted here: nobody may revoke their own
 * grant, and the last holder of user, role or grant administration keeps theirs.
 *
 * The last place of a scoped role is not removable: the database refuses a
 * scoped role that applies nowhere, so that button is not shown for it — take
 * the whole role away instead.
 */

export function UserAccessScreen({
  locale,
  messages,
  user,
  grants,
  roles,
  companies,
  branches,
  departmentNames,
  canManageGrants,
  canReadRoles,
  canReadDepartments,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly user: UserRow;
  readonly grants: readonly AccessGrant[];
  readonly roles: readonly RoleOption[];
  readonly companies: readonly CompanyView[];
  readonly branches: readonly BranchView[];
  readonly departmentNames: Readonly<Record<string, string>>;
  readonly canManageGrants: boolean;
  readonly canReadRoles: boolean;
  readonly canReadDepartments: boolean;
}) {
  const router = useRouter();
  const t = (key: string) => translate(messages, key as keyof Messages);
  const [granting, setGranting] = useState(false);
  const [addingTo, setAddingTo] = useState<AccessGrant | null>(null);
  const [removing, setRemoving] = useState<{
    readonly grant: AccessGrant;
    readonly scope: GrantScopeView;
  } | null>(null);
  const [revoking, setRevoking] = useState<AccessGrant | null>(null);
  const [outcome, setOutcome] = useState<ActionState>(IDLE);
  const [running, startRunning] = useTransition();

  const roleName = new Map(roles.map((role) => [role.id, role.name]));
  const companyName = new Map(companies.map((company) => [company.id, company.legalName]));
  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));

  const placeLabel = (scope: GrantScopeView): string => {
    if (scope.scopeType === 'company') {
      return `${t('admin.scope.company')}: ${companyName.get(scope.companyId ?? '') ?? t('users.access.unnamed')}`;
    }
    if (scope.scopeType === 'branch') {
      return `${t('admin.scope.branch')}: ${branchName.get(scope.branchId ?? '') ?? t('users.access.unnamed')}`;
    }
    const department = departmentNames[scope.departmentId ?? ''] ?? t('users.access.unnamed');
    const inBranch = branchName.get(scope.branchId ?? '');
    return `${t('users.access.department')}: ${department}${inBranch ? ` — ${inBranch}` : ''}`;
  };

  const run = (task: () => Promise<ActionState>, onSuccess: () => void) => {
    startRunning(async () => {
      const result = await task();
      setOutcome({ ...result, attempt: (outcome.attempt ?? 0) + 1 });
      notifyActionResult(result, messages);
      if (result.status === 'success') {
        onSuccess();
        router.refresh();
      }
    });
  };

  const active = grants.filter((grant) => grant.status === 'active');
  const assignable = roles.filter((role) => !role.isSystem);

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-border-subtle bg-surface p-5 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-section-title font-semibold text-text-heading">
              {user.displayName}
            </h2>
            <p className="mt-1 break-all text-supporting text-text-secondary">{user.email}</p>
          </div>
          <span className="text-supporting text-text-secondary">
            {t(`users.status.${user.status}`)}
          </span>
        </div>
      </section>

      <aside className="rounded-xl border border-info-border bg-info-subtle p-4">
        <p className="text-label font-semibold text-text-primary">
          {t('users.access.explainTitle')}
        </p>
        <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-supporting text-text-secondary">
          <li>{t('users.access.explainOrganisation')}</li>
          <li>{t('users.access.explainOneBranch')}</li>
          <li>{t('users.access.explainSeveralBranches')}</li>
        </ul>
      </aside>

      <section
        aria-labelledby="user-access-roles"
        className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-5 shadow-xs"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="user-access-roles" className="text-section-title font-semibold text-text-heading">
            {t('users.detail.grants')}
          </h2>
          {canManageGrants && assignable.length > 0 ? (
            <button
              type="button"
              className={PRIMARY_BUTTON}
              onClick={() => {
                setOutcome(IDLE);
                setGranting(true);
              }}
            >
              {t('users.access.grant')}
            </button>
          ) : null}
        </div>
        {canManageGrants && !canReadRoles ? (
          <p className="text-supporting text-text-secondary">{t('users.access.needsRoleRead')}</p>
        ) : null}

        {active.length === 0 ? (
          <EmptyState
            messages={messages}
            titleKey="users.detail.noGrants"
            descriptionKey="users.access.noGrantsBody"
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {active.map((grant) => (
              <li key={grant.id} className="rounded-lg border border-border-subtle p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-label font-semibold text-text-primary">
                      {roleName.get(grant.roleId) ?? t('users.access.unnamedRole')}
                    </p>
                    <p className="text-caption text-text-muted">
                      {formatMessage(t('users.access.since'), {
                        date: formatDate(grant.validFrom, locale),
                      })}
                      {grant.validTo
                        ? ` · ${formatMessage(t('users.access.until'), {
                            date: formatDate(grant.validTo, locale),
                          })}`
                        : ''}
                    </p>
                  </div>
                  <StatusPill status={grant.status} messages={messages} />
                </div>

                {grant.scopeMode !== 'scoped' ? (
                  <p className="mt-3 text-supporting text-text-primary">
                    {t('users.access.scope.summaryOrganisation')}
                  </p>
                ) : grant.scopes === null ? (
                  <p className="mt-3 text-supporting text-text-secondary">
                    {t('users.access.scopesUnavailable')}
                  </p>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    <p className="text-supporting text-text-primary">
                      {t(
                        grant.scopes.length === 1
                          ? 'users.access.appliesInOne'
                          : 'users.access.appliesInSeveral'
                      )}
                    </p>
                    <ul className="flex flex-col gap-1">
                      {grant.scopes.map((scope) => (
                        <li
                          key={scope.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-subtle px-3 py-2 text-supporting text-text-primary"
                        >
                          <span>{placeLabel(scope)}</span>
                          {canManageGrants && grant.scopes && grant.scopes.length > 1 ? (
                            <button
                              type="button"
                              className={SECONDARY_BUTTON}
                              aria-label={`${t('users.access.removeScope')}: ${placeLabel(scope)}`}
                              onClick={() => {
                                setOutcome(IDLE);
                                setRemoving({ grant, scope });
                              }}
                            >
                              {t('users.access.removeScope')}
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {canManageGrants && grant.scopes.length === 1 ? (
                      <p className="text-caption text-text-muted">{t('users.access.lastScope')}</p>
                    ) : null}
                  </div>
                )}

                {canManageGrants ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {grant.scopeMode === 'scoped' ? (
                      <button
                        type="button"
                        className={SECONDARY_BUTTON}
                        onClick={() => {
                          setOutcome(IDLE);
                          setAddingTo(grant);
                        }}
                      >
                        {t('users.access.addScope')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={SECONDARY_BUTTON}
                      aria-label={`${t('users.access.revoke')}: ${
                        roleName.get(grant.roleId) ?? t('users.access.unnamedRole')
                      }`}
                      onClick={() => {
                        setOutcome(IDLE);
                        setRevoking(grant);
                      }}
                    >
                      {t('users.access.revoke')}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canManageGrants && active.length > 0 ? (
          <p className="text-caption text-text-muted">{t('users.access.revokeLimits')}</p>
        ) : null}
      </section>

      {granting ? (
        <ScopeDialog
          messages={messages}
          title={t('users.access.grant')}
          roles={assignable}
          allowOrganisation
          companies={companies}
          branches={branches}
          canReadDepartments={canReadDepartments}
          pending={running}
          outcome={outcome}
          onCancel={() => setGranting(false)}
          onSubmit={({ roleId, mode, scopes }) =>
            run(
              () =>
                issueGrantAction({
                  userId: user.id,
                  roleId,
                  wholeOrganisation: mode === 'organisation',
                  scopes,
                }),
              () => setGranting(false)
            )
          }
        />
      ) : null}

      {addingTo ? (
        <ScopeDialog
          messages={messages}
          title={`${t('users.access.addScope')} — ${roleName.get(addingTo.roleId) ?? t('users.access.unnamedRole')}`}
          roles={[]}
          allowOrganisation={false}
          companies={companies}
          branches={branches}
          canReadDepartments={canReadDepartments}
          pending={running}
          outcome={outcome}
          onCancel={() => setAddingTo(null)}
          onSubmit={({ scopes }) =>
            run(
              () => addGrantScopesAction(addingTo.id, scopes),
              () => setAddingTo(null)
            )
          }
        />
      ) : null}

      {removing ? (
        <ConfirmDialog
          open
          messages={messages}
          destructive
          pending={running}
          title={t('users.access.confirmRemoveScope')}
          description={placeLabel(removing.scope)}
          confirmLabel={t('users.access.removeScope')}
          error={
            outcome.status !== 'idle' && outcome.status !== 'success'
              ? translateWithValues(
                  messages,
                  outcome.messageKey ?? 'admin.actionFailed',
                  outcome.messageValues
                )
              : undefined
          }
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            run(
              () => removeGrantScopeAction(removing.grant.id, removing.scope.id),
              () => setRemoving(null)
            )
          }
        />
      ) : null}

      {revoking ? (
        <ReasonConfirmDialog
          open
          messages={messages}
          destructive
          pending={running}
          title={t('users.access.confirmRevoke')}
          description={`${roleName.get(revoking.roleId) ?? t('users.access.unnamedRole')} — ${user.displayName}`}
          confirmLabel={t('users.access.revoke')}
          reasonLabel={t('admin.reason')}
          error={
            outcome.status !== 'idle' && outcome.status !== 'success'
              ? translateWithValues(
                  messages,
                  outcome.messageKey ?? 'admin.actionFailed',
                  outcome.messageValues
                )
              : undefined
          }
          onCancel={() => setRevoking(null)}
          onConfirm={(reasonText) =>
            run(
              () => revokeGrantAction(revoking.id, revoking.recordVersion, reasonText),
              () => setRevoking(null)
            )
          }
        />
      ) : null}
    </div>
  );
}

/**
 * Chooses a role (when granting) and the places it applies.
 *
 * The sentence under the choice changes with it — "in one branch only", "in each
 * of the 3 selected branches", "everywhere in the organisation" — so the
 * operator reads the consequence before confirming it.
 */
function ScopeDialog({
  messages,
  title,
  roles,
  allowOrganisation,
  companies,
  branches,
  canReadDepartments,
  pending,
  outcome,
  onCancel,
  onSubmit,
}: {
  readonly messages: Messages;
  readonly title: string;
  readonly roles: readonly RoleOption[];
  readonly allowOrganisation: boolean;
  readonly companies: readonly CompanyView[];
  readonly branches: readonly BranchView[];
  readonly canReadDepartments: boolean;
  readonly pending: boolean;
  readonly outcome: ActionState;
  readonly onCancel: () => void;
  readonly onSubmit: (choice: {
    readonly roleId: string;
    readonly mode: ScopeMode;
    readonly scopes: readonly ScopeRequest[];
  }) => void;
}) {
  const t = (key: string) => translate(messages, key as keyof Messages);
  const granting = roles.length > 0;
  const [roleId, setRoleId] = useState('');
  const [mode, setMode] = useState<ScopeMode>(allowOrganisation ? 'organisation' : 'branches');
  const [chosen, setChosen] = useState<ReadonlyMap<string, ScopeRequest>>(new Map());
  const [branch, setBranch] = useState<BranchView | null>(null);
  const [departments, setDepartments] = useState<ReadState<readonly DepartmentView[]> | null>(null);
  const [loading, startLoading] = useTransition();

  const toggle = (id: string, scope: ScopeRequest, on: boolean) => {
    setChosen((current) => {
      const next = new Map(current);
      if (on) next.set(id, scope);
      else next.delete(id);
      return next;
    });
  };

  const modes: readonly ScopeMode[] = [
    ...(allowOrganisation ? (['organisation'] as const) : []),
    'companies',
    'branches',
    ...(canReadDepartments ? (['departments'] as const) : []),
  ];

  const scopes = mode === 'organisation' ? [] : [...chosen.values()];
  const summary = formatMessage(t(scopeSummaryKey(mode, scopes.length)), {
    count: String(scopes.length),
  });

  return (
    <Dialog open onClose={onCancel} messages={messages} title={title} width="lg">
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ roleId, mode, scopes });
        }}
      >
        <FormFeedback
          state={outcome.status === 'idle' || outcome.status === 'success' ? IDLE : outcome}
          messages={messages}
        />

        {granting ? (
          <SelectField
            name="roleId"
            label={t('users.access.role')}
            required
            placeholder={t('field.selectPlaceholder')}
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
            options={roles.map((role) => ({ value: role.id, label: role.name }))}
            error={outcome.fieldErrors?.roleId ? t(outcome.fieldErrors.roleId) : undefined}
          />
        ) : null}

        <RadioGroupField
          name="scopeMode"
          label={t('users.access.where')}
          value={mode}
          onChange={(value) => {
            setMode(value as ScopeMode);
            setChosen(new Map());
          }}
          options={modes.map((value) => ({
            value,
            label: t(`users.access.mode.${value}`),
            description: t(`users.access.mode.${value}Hint`),
          }))}
        />

        {mode === 'companies' ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-label font-medium text-text-primary">
              {t('users.access.pickCompanies')}
            </legend>
            {companies.map((company) => (
              <CheckboxField
                key={company.id}
                label={company.legalName}
                checked={chosen.has(company.id)}
                onChange={(event) =>
                  toggle(
                    company.id,
                    { scopeType: 'company', companyId: company.id },
                    event.target.checked
                  )
                }
              />
            ))}
          </fieldset>
        ) : null}

        {mode === 'branches' ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-label font-medium text-text-primary">
              {t('users.access.pickBranches')}
            </legend>
            {branches.map((row) => (
              <CheckboxField
                key={row.id}
                label={
                  companies.find((company) => company.id === row.companyId)
                    ? `${row.name} — ${companies.find((company) => company.id === row.companyId)?.legalName ?? ''}`
                    : row.name
                }
                checked={chosen.has(row.id)}
                onChange={(event) =>
                  toggle(
                    row.id,
                    { scopeType: 'branch', companyId: row.companyId, branchId: row.id },
                    event.target.checked
                  )
                }
              />
            ))}
          </fieldset>
        ) : null}

        {mode === 'departments' ? (
          <div className="flex flex-col gap-2">
            <BranchPicker
              messages={messages}
              branches={branches}
              companies={companies}
              value={branch?.id ?? ''}
              onChange={(id) => {
                const next = branches.find((row) => row.id === id) ?? null;
                setBranch(next);
                setDepartments(null);
                if (!next) return;
                startLoading(async () => {
                  setDepartments(
                    await listDepartments({ companyId: next.companyId, branchId: next.id })
                  );
                });
              }}
            />
            {branch === null ? null : loading || departments === null ? (
              <LoadingState messages={messages} />
            ) : (
              <ReadBoundary state={departments} messages={messages}>
                {(rows) =>
                  rows.length === 0 ? (
                    <p className="text-supporting text-text-secondary">
                      {t('departments.emptyTitle')}
                    </p>
                  ) : (
                    <fieldset className="flex flex-col gap-2">
                      <legend className="text-label font-medium text-text-primary">
                        {t('users.access.pickDepartments')}
                      </legend>
                      {rows.map((department) => (
                        <CheckboxField
                          key={department.id}
                          label={department.name}
                          checked={chosen.has(department.id)}
                          onChange={(event) =>
                            toggle(
                              department.id,
                              {
                                scopeType: 'department',
                                companyId: department.companyId,
                                branchId: department.branchId,
                                departmentId: department.id,
                              },
                              event.target.checked
                            )
                          }
                        />
                      ))}
                    </fieldset>
                  )
                }
              </ReadBoundary>
            )}
          </div>
        ) : null}

        <p
          aria-live="polite"
          className="rounded-lg border border-border-subtle bg-surface-subtle p-3 text-supporting text-text-primary"
        >
          {summary}
        </p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-button text-text-secondary hover:bg-surface-subtle"
          >
            {t('admin.cancel')}
          </button>
          <button type="submit" className={PRIMARY_BUTTON} disabled={pending} aria-busy={pending}>
            {pending
              ? t('admin.saving')
              : t(granting ? 'users.access.grant' : 'users.access.addScope')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
