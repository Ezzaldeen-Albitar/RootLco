'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@mui/material/Button';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { ReasonDialog } from '@/components/dialogs/ReasonDialog';
import { FormCheckboxField } from '@/components/forms/mui/FormCheckboxField';
import { FormRadioGroupField } from '@/components/forms/mui/FormRadioGroupField';
import {
  FormSelectField,
  type FormSelectOption,
  type FormSelectOptionGroup,
} from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiEmptyState, MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translateDynamic, translateWithValues } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { formatDate } from '@/lib/format';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { useActionRefusal } from '@/lib/forms/use-action-refusal';
import { useEditBaseline } from '@/lib/forms/use-edit-baseline';
import { useHeldRefusal } from '@/lib/forms/use-local-refusal';
import { FormDialog } from '../../shared/components/FormDialog';
import { StatusPill } from '../../shared/components/StructureParts';
import { listDepartments } from '../../departments/api';
import type { DepartmentView } from '../../departments/types';
import type { BranchView, CompanyView } from '../../organization/types';
import {
  addGrantScopesAction,
  issueGrantAction,
  removeGrantScopeAction,
  revokeGrantAction,
  updateUserProfileAction,
} from '../actions';
import type { AccessGrant, RoleOption, UserRow } from '../api';
import { scopeSummaryKey, type GrantScopeView, type ScopeMode, type ScopeRequest } from '../types';
import { roleDisplayName } from '../../access/role-name';

/**
 * One user's account and access, on Material UI (ADR-022, `P1-32-PRE-OD-ADM3`):
 * their details, which roles they hold, and where each role applies.
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
 * ## Granting across the whole organisation asks first
 *
 * `iam.grant-issue` reads an EMPTY scope list as the whole organisation
 * (`actions.ts`, `issueGrantAction`). That is the widest thing this screen can
 * do, so before it is sent the operator is shown a confirmation naming the
 * role and the effect — every company, branch and department, including ones
 * added later. Nothing about the request changes; the question only makes the
 * consequence of an empty list explicit before it is asked for.
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
 *
 * ## The account's own details
 *
 * `iam.user-update` (`iam.user.manage`) changes the display name and whether
 * two-factor authentication is required, guarded by the version the screen
 * displayed: a change made by someone else in between is a conflict with a way
 * to load the latest, never an overwrite.
 *
 * ## One press, one request
 *
 * Every write is held by a ref while its answer is awaited, so two presses
 * inside one frame send one request; the disabled button is the visible half
 * of the same rule.
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
  canManageUser = false,
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
  /** `iam.user.manage`, the code `iam.user-update` declares. */
  readonly canManageUser?: boolean;
  readonly canReadRoles: boolean;
  readonly canReadDepartments: boolean;
}) {
  const router = useRouter();
  const t = (key: string) => translateDynamic(messages, key);
  const [granting, setGranting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addingTo, setAddingTo] = useState<AccessGrant | null>(null);
  const [removing, setRemoving] = useState<{
    readonly grant: AccessGrant;
    readonly scope: GrantScopeView;
  } | null>(null);
  const [revoking, setRevoking] = useState<AccessGrant | null>(null);
  const [outcome, setOutcome] = useState<ActionState>(IDLE);
  const [running, startRunning] = useTransition();
  const inFlight = useRef(false);

  const roleName = new Map(roles.map((role) => [role.id, roleDisplayName(messages, role)]));
  const companyName = new Map(companies.map((company) => [company.id, company.legalName]));
  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
  const roleLabel = (roleId: string) => roleName.get(roleId) ?? t('users.access.unnamedRole');

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
    if (inFlight.current) return;
    inFlight.current = true;
    startRunning(async () => {
      let result: ActionState;
      try {
        result = await task();
      } catch {
        result = { status: 'unavailable', messageKey: 'state.unavailable.message', attempt: 1 };
      } finally {
        inFlight.current = false;
      }
      setOutcome((was) => ({ ...result, attempt: (was.attempt ?? 0) + 1 }));
      notifyActionResult(result, messages);
      if (result.status === 'success') {
        onSuccess();
        router.refresh();
      }
    });
  };

  const refusalSentence = (state: ActionState): string | undefined =>
    state.status !== 'idle' && state.status !== 'success'
      ? translateWithValues(messages, state.messageKey ?? 'admin.actionFailed', state.messageValues)
      : undefined;

  const active = grants.filter((grant) => grant.status === 'active');
  const assignable = roles.filter((role) => !role.isSystem);

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="user-access-account"
        className="rounded-xl border border-border-subtle bg-surface p-5 shadow-xs"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="user-access-account"
              className="text-section-title font-semibold text-text-heading"
            >
              {user.displayName}
            </h2>
            <p className="mt-1 break-all text-supporting text-text-secondary" dir="ltr">
              {user.email}
            </p>
            <p className="mt-1 text-supporting text-text-secondary">
              {t(user.mfaRequired ? 'users.detail.mfaRequired' : 'users.detail.mfaNotRequired')}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="text-supporting text-text-secondary">
              {t(`users.status.${user.status}`)}
            </span>
            {canManageUser ? (
              <Button
                type="button"
                variant="outlined"
                size="small"
                aria-label={`${t('users.edit.open')}: ${user.displayName}`}
                onClick={() => setEditing(true)}
              >
                {t('users.edit.open')}
              </Button>
            ) : null}
          </div>
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
            <Button
              type="button"
              variant="contained"
              onClick={() => {
                setOutcome(IDLE);
                setGranting(true);
              }}
            >
              {t('users.access.grant')}
            </Button>
          ) : null}
        </div>
        {canManageGrants && !canReadRoles ? (
          <p className="text-supporting text-text-secondary">{t('users.access.needsRoleRead')}</p>
        ) : null}

        {active.length === 0 ? (
          <MuiEmptyState
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
                      {roleLabel(grant.roleId)}
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
                            <Button
                              type="button"
                              size="small"
                              variant="outlined"
                              color="inherit"
                              aria-label={`${t('users.access.removeScope')}: ${placeLabel(scope)}`}
                              onClick={() => {
                                setOutcome(IDLE);
                                setRemoving({ grant, scope });
                              }}
                            >
                              {t('users.access.removeScope')}
                            </Button>
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
                      <Button
                        type="button"
                        size="small"
                        variant="outlined"
                        aria-label={`${t('users.access.addScope')}: ${roleLabel(grant.roleId)}`}
                        onClick={() => {
                          setOutcome(IDLE);
                          setAddingTo(grant);
                        }}
                      >
                        {t('users.access.addScope')}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="small"
                      variant="outlined"
                      color="error"
                      aria-label={`${t('users.access.revoke')}: ${roleLabel(grant.roleId)}`}
                      onClick={() => {
                        setOutcome(IDLE);
                        setRevoking(grant);
                      }}
                    >
                      {t('users.access.revoke')}
                    </Button>
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

      {editing ? (
        <EditDetailsDialog
          messages={messages}
          user={user}
          onClose={() => setEditing(false)}
          onSaved={() => router.refresh()}
          onLoadLatest={() => router.refresh()}
        />
      ) : null}

      {granting ? (
        <ScopeDialog
          messages={messages}
          title={t('users.access.grant')}
          submitLabel={t('users.access.grant')}
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
          title={`${t('users.access.addScope')} — ${roleLabel(addingTo.roleId)}`}
          submitLabel={t('users.access.addScope')}
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

      <ConfirmDialog
        open={removing !== null}
        messages={messages}
        destructive
        pending={running}
        title={t('users.access.confirmRemoveScope')}
        description={
          removing ? `${roleLabel(removing.grant.roleId)} — ${placeLabel(removing.scope)}` : ''
        }
        confirmLabel={t('users.access.removeScope')}
        error={refusalSentence(outcome)}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          const { grant, scope } = removing;
          run(
            () => removeGrantScopeAction(grant.id, scope.id),
            () => setRemoving(null)
          );
        }}
      />

      <ReasonDialog
        open={revoking !== null}
        messages={messages}
        destructive
        countsAsUnsaved
        pending={running}
        maxLength={500}
        title={t('users.access.confirmRevoke')}
        description={revoking ? `${roleLabel(revoking.roleId)} — ${user.displayName}` : ''}
        confirmLabel={t('users.access.revoke')}
        reasonLabel={t('admin.reason')}
        reasonError={
          outcome.fieldErrors?.reason && outcome.status !== 'success'
            ? t(outcome.fieldErrors.reason)
            : undefined
        }
        error={outcome.fieldErrors?.reason ? undefined : refusalSentence(outcome)}
        onCancel={() => setRevoking(null)}
        onConfirm={(reasonText) => {
          if (!revoking) return;
          const grant = revoking;
          run(
            () => revokeGrantAction(grant.id, grant.recordVersion, reasonText),
            () => setRevoking(null)
          );
        }}
      />
    </div>
  );
}

/**
 * The account's name and its two-factor requirement — `iam.user-update`.
 *
 * Both entries are held against the version the screen displayed
 * (`useEditBaseline`): either one changed is unsaved work, a clean form follows
 * the record, and the save sends the displayed version as `If-Match`. A
 * conflict keeps what was typed and offers the latest version instead.
 */
function EditDetailsDialog({
  messages,
  user,
  onClose,
  onSaved,
  onLoadLatest,
}: {
  readonly messages: Messages;
  readonly user: UserRow;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  readonly onLoadLatest: () => void;
}) {
  const t = (key: string) => translateDynamic(messages, key);
  const edit = useEditBaseline<{ readonly displayName: string; readonly mfaRequired: boolean }>({
    stored: { displayName: user.displayName, mfaRequired: user.mfaRequired },
    storedVersion: user.recordVersion,
    differs: (values, baseline) =>
      values.displayName.trim() !== baseline.displayName.trim() ||
      values.mfaRequired !== baseline.mfaRequired,
  });
  const [outcome, setOutcome] = useState<ActionState>(IDLE);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const { errors, formRef } = useHeldRefusal(fieldErrors, {
    displayName: edit.values.displayName,
  });
  useUnsavedGuard(edit.dirty, onClose);

  const submit = async () => {
    if (inFlight.current) return;
    if (edit.values.displayName.trim() === '') {
      setFieldErrors({ displayName: 'field.required' });
      setOutcome(IDLE);
      return;
    }
    if (!edit.dirty) {
      setFieldErrors({});
      setOutcome({ status: 'invalid', messageKey: 'users.edit.unchanged', attempt: 1 });
      return;
    }
    inFlight.current = true;
    setSaving(true);
    let result: ActionState;
    try {
      result = await updateUserProfileAction(user.id, edit.version, edit.values, edit.baseline);
    } catch {
      result = { status: 'unavailable', messageKey: 'state.unavailable.message', attempt: 1 };
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
    notifyActionResult(result, messages);
    if (result.status === 'success') {
      edit.rebase({
        displayName: edit.values.displayName.trim(),
        mfaRequired: edit.values.mfaRequired,
      });
      onSaved();
      onClose();
      return;
    }
    setFieldErrors(result.fieldErrors ?? {});
    setOutcome(result);
  };

  // The conflict's way out: what is stored now replaces the stale work, and the
  // page is read again so the newer details and version arrive here.
  const loadLatest = () => {
    edit.discard();
    setFieldErrors({});
    setOutcome(IDLE);
    onLoadLatest();
  };

  const refusal =
    outcome.status !== 'idle' &&
    outcome.status !== 'success' &&
    Object.keys(outcome.fieldErrors ?? {}).length === 0
      ? translateWithValues(
          messages,
          outcome.messageKey ?? 'admin.actionFailed',
          outcome.messageValues
        )
      : undefined;

  return (
    // A form, so the shared `FormDialog` — a dialog, not an alert (`P1-32-PRE-OD-ADM4`).
    <FormDialog
      messages={messages}
      title={t('users.edit.title')}
      description={t('users.edit.description')}
      submitLabel={t('users.edit.save')}
      pending={saving}
      error={refusal}
      onCancel={onClose}
      onSubmit={() => void submit()}
      formRef={formRef}
      testId="users-edit-dialog"
    >
      <FormTextField
        name="displayName"
        label={t('users.edit.displayName')}
        required
        autoFocus
        autoComplete="off"
        maxLength={200}
        value={edit.values.displayName}
        onChange={(displayName) => edit.setValues((was) => ({ ...was, displayName }))}
        error={errors['displayName'] ? t(errors['displayName']) : undefined}
      />
      <FormCheckboxField
        name="mfaRequired"
        label={t('users.edit.mfaRequired')}
        description={t('users.edit.mfaRequiredHint')}
        checked={edit.values.mfaRequired}
        onChange={(mfaRequired) => edit.setValues((was) => ({ ...was, mfaRequired }))}
      />
      {outcome.status === 'conflict' ? (
        <div>
          <Button type="button" variant="outlined" size="small" onClick={loadLatest}>
            {t('form.loadLatest')}
          </Button>
        </div>
      ) : null}
    </FormDialog>
  );
}

/**
 * Chooses a role (when granting) and the places it applies.
 *
 * The sentence under the choice changes with it — "in one branch only", "in each
 * of the 3 selected branches", "everywhere in the organisation" — so the
 * operator reads the consequence before confirming it. Choosing the whole
 * organisation is confirmed once more, by name, before anything is sent.
 *
 * Every choice — the role, where it applies, each chosen place and the branch
 * whose departments are listed — counts as unsaved work while the dialog is
 * open.
 */
function ScopeDialog({
  messages,
  title,
  submitLabel,
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
  readonly submitLabel: string;
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
  const t = (key: string) => translateDynamic(messages, key);
  const granting = roles.length > 0;
  const initialMode: ScopeMode = allowOrganisation ? 'organisation' : 'branches';
  const [roleId, setRoleId] = useState('');
  const [mode, setMode] = useState<ScopeMode>(initialMode);
  const [chosen, setChosen] = useState<ReadonlyMap<string, ScopeRequest>>(new Map());
  const [branchId, setBranchId] = useState('');
  const [departments, setDepartments] = useState<ReadState<readonly DepartmentView[]> | null>(null);
  const [confirmingOrganisation, setConfirmingOrganisation] = useState(false);
  // The branch whose departments were asked for last: an answer for another
  // branch is a reply to a question nobody is asking any more, and is dropped.
  const asked = useRef('');

  useUnsavedGuard(
    roleId !== '' || mode !== initialMode || chosen.size > 0 || branchId !== '',
    onCancel
  );

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

  // The cursor goes to the refused role or places, and the complaint goes once
  // another is chosen (route sweep B3).
  const {
    edited: refusalEdited,
    errorKey: refusalErrorKey,
    formRef: refusalFormRef,
  } = useActionRefusal(outcome);
  const scopes = mode === 'organisation' ? [] : [...chosen.values()];
  const summary = formatMessage(t(scopeSummaryKey(mode, scopes.length)), {
    count: String(scopes.length),
  });
  const roleError = refusalErrorKey('roleId');
  const placesError = refusalErrorKey('scopes');
  const fieldRefused = Object.keys(outcome.fieldErrors ?? {}).length > 0;
  const refusal =
    outcome.status !== 'idle' && outcome.status !== 'success' && !fieldRefused
      ? translateWithValues(
          messages,
          outcome.messageKey ?? 'admin.actionFailed',
          outcome.messageValues
        )
      : undefined;

  const companyName = new Map(companies.map((company) => [company.id, company.legalName]));
  const branchLabel = (row: BranchView) =>
    companyName.has(row.companyId)
      ? `${row.name} — ${companyName.get(row.companyId) as string}`
      : row.name;
  const branchGroups: readonly FormSelectOptionGroup[] = companies
    .map((company) => ({
      label: company.legalName,
      options: branches
        .filter((row) => row.companyId === company.id)
        .map((row): FormSelectOption => ({ value: row.id, label: row.name })),
    }))
    .filter((group) => group.options.length > 0);
  const ungroupedBranches: readonly FormSelectOption[] = branches
    .filter((row) => !companyName.has(row.companyId))
    .map((row) => ({ value: row.id, label: row.name }));

  const chooseBranch = (id: string) => {
    setBranchId(id);
    setDepartments(null);
    asked.current = id;
    const row = branches.find((candidate) => candidate.id === id);
    if (!row) return;
    void (async () => {
      let read: ReadState<readonly DepartmentView[]>;
      try {
        read = await listDepartments({ companyId: row.companyId, branchId: row.id });
      } catch {
        read = { status: 'unavailable', correlationId: null };
      }
      if (asked.current === id) setDepartments(read);
    })();
  };

  const send = () => onSubmit({ roleId, mode, scopes });
  const submit = () => {
    if (pending) return;
    // The whole organisation is the widest grant there is: asked once more, by
    // name, before the empty list that means it is sent. A grant with no role
    // chosen goes straight to the action, whose refusal names the role box.
    if (granting && mode === 'organisation' && roleId !== '') {
      setConfirmingOrganisation(true);
      return;
    }
    send();
  };

  const chosenRole = roles.find((role) => role.id === roleId);

  return (
    <>
      {/* A form, so the shared `FormDialog` — a dialog, not an alert (`P1-32-PRE-OD-ADM4`). */}
      <FormDialog
        messages={messages}
        title={title}
        submitLabel={submitLabel}
        pending={pending}
        error={refusal}
        onCancel={onCancel}
        onSubmit={submit}
        formRef={refusalFormRef}
        testId="users-scope-dialog"
      >
        {granting ? (
          <FormSelectField
            name="roleId"
            label={t('users.access.role')}
            required
            placeholder={t('field.selectPlaceholder')}
            value={roleId}
            onEdit={() => refusalEdited('roleId')}
            onChange={setRoleId}
            options={roles.map((role) => ({
              value: role.id,
              label: roleDisplayName(messages, role),
            }))}
            error={roleError ? t(roleError) : undefined}
          />
        ) : null}

        <FormRadioGroupField
          name="scopeMode"
          label={t('users.access.where')}
          value={mode}
          onEdit={() => refusalEdited('scopes')}
          onChange={(value) => {
            setMode(value as ScopeMode);
            setChosen(new Map());
          }}
          options={modes.map((value) => ({
            value,
            label: t(`users.access.mode.${value}`),
            description: t(`users.access.mode.${value}Hint`),
          }))}
          error={placesError ? t(placesError) : undefined}
        />

        {mode === 'companies' ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="text-label font-medium text-text-primary">
              {t('users.access.pickCompanies')}
            </legend>
            {companies.map((company) => (
              <FormCheckboxField
                key={company.id}
                label={company.legalName}
                checked={chosen.has(company.id)}
                onChange={(on) => {
                  refusalEdited('scopes');
                  toggle(company.id, { scopeType: 'company', companyId: company.id }, on);
                }}
              />
            ))}
          </fieldset>
        ) : null}

        {mode === 'branches' ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="text-label font-medium text-text-primary">
              {t('users.access.pickBranches')}
            </legend>
            {branches.map((row) => (
              <FormCheckboxField
                key={row.id}
                label={branchLabel(row)}
                checked={chosen.has(row.id)}
                onChange={(on) => {
                  refusalEdited('scopes');
                  toggle(
                    row.id,
                    { scopeType: 'branch', companyId: row.companyId, branchId: row.id },
                    on
                  );
                }}
              />
            ))}
          </fieldset>
        ) : null}

        {mode === 'departments' ? (
          <div className="flex flex-col gap-2">
            <FormSelectField
              name="departmentBranch"
              label={t('admin.scope.branch')}
              placeholder={t('admin.scope.pickBranch')}
              value={branchId}
              onChange={chooseBranch}
              options={ungroupedBranches}
              groups={branchGroups}
            />
            {branchId === '' ? null : departments === null ? (
              <MuiLoadingState messages={messages} variant="inline" />
            ) : departments.status !== 'ok' ? (
              <MuiReadFailureState
                messages={messages}
                status={departments.status}
                correlationId={departments.correlationId}
                onRetry={() => chooseBranch(branchId)}
              />
            ) : departments.data.length === 0 ? (
              <p className="text-supporting text-text-secondary">{t('departments.emptyTitle')}</p>
            ) : (
              <fieldset className="flex flex-col gap-1">
                <legend className="text-label font-medium text-text-primary">
                  {t('users.access.pickDepartments')}
                </legend>
                {departments.data.map((department) => (
                  <FormCheckboxField
                    key={department.id}
                    label={department.name}
                    checked={chosen.has(department.id)}
                    onChange={(on) => {
                      refusalEdited('scopes');
                      toggle(
                        department.id,
                        {
                          scopeType: 'department',
                          companyId: department.companyId,
                          branchId: department.branchId,
                          departmentId: department.id,
                        },
                        on
                      );
                    }}
                  />
                ))}
              </fieldset>
            )}
          </div>
        ) : null}

        <p
          aria-live="polite"
          className="rounded-lg border border-border-subtle bg-surface-subtle p-3 text-supporting text-text-primary"
        >
          {summary}
        </p>
      </FormDialog>

      <ConfirmDialog
        open={confirmingOrganisation}
        messages={messages}
        pending={pending}
        title={t('users.access.confirmOrganisation.title')}
        description={translateWithValues(messages, 'users.access.confirmOrganisation.body', {
          role: chosenRole ? roleDisplayName(messages, chosenRole) : t('users.access.unnamedRole'),
        })}
        confirmLabel={t('users.access.confirmOrganisation.confirm')}
        testId="users-scope-organisation-confirm"
        onCancel={() => setConfirmingOrganisation(false)}
        onConfirm={() => {
          setConfirmingOrganisation(false);
          send();
        }}
      />
    </>
  );
}
