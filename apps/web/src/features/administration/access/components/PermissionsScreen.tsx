'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiEmptyState, MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic, translateWithValues } from '@/i18n/get-messages';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { readPermissionCatalogue, type PermissionCatalogue } from '../api';
import type { PermissionRow, RolePermissionRow, RoleRow } from '../types';
import { roleDisplayName } from '../role-name';
import {
  addRolePermissionAction,
  changeRolePermissionEffectAction,
  removeRolePermissionAction,
} from '../actions';

/**
 * The permission catalogue, and what one role does with it — on Material UI
 * (ADR-022, `P1-32-PRE-OD-ADM4`).
 *
 * ## The notice at the top is the point of the screen
 *
 * "What you see here is a convenience. Every request is checked by the service,
 * and its decision is the one that applies." An administration screen that lists
 * permissions invites the belief that this list *is* the access control. It is
 * not; it is a view of `iam.role_permissions`, and the database decides.
 *
 * ## What a manager can do with a permission
 *
 * Map it (allow or deny) when the role does not carry it; change an existing
 * mapping between allow and deny (`iam.role-permission-update`, the mapping's
 * version as `If-Match`); or remove the mapping, after a confirmation. A mapping
 * changed since the screen read it is the server's conflict, said with "Load
 * the latest version" — never retried here. Each change is sent once: while one
 * is in flight every change control is disabled, and a second press inside the
 * same frame sends nothing.
 *
 * ## Escalation
 *
 * `assertDelegable` refuses a permission the actor does not itself hold — on an
 * add and on a change TO allow — and the refusal arrives as a denial from the
 * server. This screen warns before a high-risk grant — advice, ahead of an
 * authoritative answer — and does not duplicate the rule.
 *
 * ## Reads
 *
 * A refused or failed read of the catalogue OR of the role's mappings is drawn
 * through the shared states with its reference, never as a role that holds
 * nothing.
 */
export function PermissionsScreen({
  messages,
  locale,
  roles,
  canManage,
}: {
  readonly messages: Messages;
  readonly locale?: Locale | undefined;
  readonly roles: readonly RoleRow[];
  readonly canManage: boolean;
}) {
  const t = (key: string) => translateDynamic(messages, key);

  const [roleId, setRoleId] = useState<string>(roles[0]?.id ?? '');
  const [generation, setGeneration] = useState(0);
  const [held, setHeld] = useState<{
    readonly key: string;
    readonly permissions: readonly PermissionRow[];
    readonly mappings: readonly RolePermissionRow[];
    readonly status: PermissionCatalogue['status'];
    readonly correlationId: string | null;
  } | null>(null);
  const [outcome, setOutcome] = useState<ActionState>(IDLE);
  const [removing, setRemoving] = useState<{
    readonly mappingId: string;
    readonly code: string;
  } | null>(null);
  const [running, setRunning] = useState(false);
  // The change in flight, held across the frame the disabled state needs to
  // reach the buttons: two presses inside one frame send one request.
  const inFlight = useRef(false);

  const wanted = `${roleId}#${generation}`;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let result: PermissionCatalogue;
      try {
        result = await readPermissionCatalogue(roleId || null);
      } catch {
        // No answer came back: said as an outage, with a retry.
        result = { status: 'unavailable', permissions: [], mappings: [], correlationId: null };
      }
      if (cancelled) return;
      setHeld({
        key: wanted,
        permissions: result.permissions,
        mappings: result.mappings,
        status: result.status,
        correlationId: result.correlationId,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [wanted, roleId]);

  const refresh = () => setGeneration((value) => value + 1);
  const loading = held === null || held.key !== wanted;
  const selectedRole = roles.find((role) => role.id === roleId) ?? null;
  const editable = canManage && roleId !== '' && !selectedRole?.isSystem;

  const byCode = useMemo(() => {
    const map = new Map<string, RolePermissionRow>();
    for (const mapping of held?.mappings ?? []) {
      const code = mapping.permissionCode ?? mapping.code;
      if (code) map.set(code, mapping);
    }
    return map;
  }, [held]);

  const grouped = useMemo(() => {
    const groups = new Map<string, PermissionRow[]>();
    for (const permission of held?.permissions ?? []) {
      const list = groups.get(permission.domain) ?? [];
      list.push(permission);
      groups.set(permission.domain, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [held]);

  const mutate = async (task: () => Promise<ActionState>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    let result: ActionState;
    try {
      result = await task();
    } catch {
      // The answer never arrived: nothing is known to have changed.
      result = { status: 'unavailable', messageKey: 'state.unavailable.message', attempt: 1 };
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
    notifyActionResult(result, messages);
    // The attempt number makes a repeated refusal a new announcement.
    setOutcome((was) => ({ ...result, attempt: (was.attempt ?? 0) + 1 }));
    if (result.status === 'success') {
      setRemoving(null);
      refresh();
    }
    if (result.status === 'conflict') setRemoving(null);
  };

  const refused = outcome.status !== 'idle' && outcome.status !== 'success';

  if (roles.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <p className="rounded-lg border border-info-border bg-info-subtle p-3 text-supporting text-text-secondary">
          {t('permissions.visibilityNotice')}
        </p>
        <MuiEmptyState
          messages={messages}
          titleKey="permissions.noRoles.title"
          descriptionKey="permissions.noRoles.body"
          testId="permissions-no-roles"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="permissions-screen">
      <p className="rounded-lg border border-info-border bg-info-subtle p-3 text-supporting text-text-secondary">
        {t('permissions.visibilityNotice')}
      </p>

      <div className="max-w-md">
        <FormSelectField
          name="roleId"
          label={t('permissions.selectRole')}
          description={t('permissions.selectRoleHint')}
          value={roleId}
          onChange={(next) => {
            setOutcome(IDLE);
            setRoleId(next);
          }}
          options={roles.map((role) => ({
            value: role.id,
            label: roleDisplayName(messages, role),
          }))}
          disabled={running}
        />
      </div>

      {selectedRole?.isSystem ? (
        <p role="status" className="text-supporting text-text-secondary">
          {t('roles.systemLocked')}
        </p>
      ) : null}

      {refused ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-body text-error">
            {translateWithValues(
              messages,
              outcome.messageKey ?? 'admin.actionFailed',
              outcome.messageValues
            )}
          </p>
          {outcome.status === 'conflict' ? (
            <Button
              type="button"
              variant="outlined"
              size="small"
              onClick={() => {
                setOutcome(IDLE);
                refresh();
              }}
            >
              {t('form.loadLatest')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <MuiLoadingState messages={messages} testId="permissions-loading" />
      ) : held.status !== 'ok' ? (
        <MuiReadFailureState
          messages={messages}
          locale={locale}
          status={held.status}
          correlationId={held.correlationId}
          onRetry={refresh}
          testId="permissions-failure"
        />
      ) : grouped.length === 0 ? (
        <MuiEmptyState messages={messages} testId="permissions-empty" />
      ) : (
        grouped.map(([domain, permissions]) => (
          <section key={domain} className="rounded-xl border border-border-subtle bg-surface p-4">
            <h3 className="text-label font-semibold uppercase tracking-wide text-text-muted">
              <bdi>{domain}</bdi>
            </h3>
            <TableContainer className="mt-3" aria-busy={running || undefined}>
              <Table size="small">
                <caption className="sr-only">{`${t('permissions.title')} — ${domain}`}</caption>
                <TableHead>
                  <TableRow>
                    <TableCell scope="col">{t('permissions.column.code')}</TableCell>
                    <TableCell scope="col">{t('column.description')}</TableCell>
                    <TableCell scope="col">{t('permissions.column.risk')}</TableCell>
                    <TableCell scope="col">{t('permissions.column.effect')}</TableCell>
                    {editable ? <TableCell scope="col">{t('admin.actions')}</TableCell> : null}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {permissions.map((permission) => {
                    const mapping = byCode.get(permission.code);
                    return (
                      <TableRow key={permission.id}>
                        <TableCell>
                          <code className="font-mono text-caption text-text-secondary" dir="ltr">
                            {permission.code}
                          </code>
                        </TableCell>
                        <TableCell>{permission.description}</TableCell>
                        <TableCell>
                          <RiskPill level={permission.riskLevel} messages={messages} />
                        </TableCell>
                        <TableCell>
                          {mapping ? (
                            <span
                              className={mapping.effect === 'allow' ? 'text-success' : 'text-error'}
                            >
                              {t(`permissions.effect.${mapping.effect}`)}
                            </span>
                          ) : (
                            <span className="text-text-muted">{t('permissions.effect.unset')}</span>
                          )}
                        </TableCell>
                        {editable ? (
                          <TableCell>
                            <div className="flex flex-wrap justify-end gap-1">
                              {mapping ? (
                                <>
                                  {mapping.recordVersion !== undefined ? (
                                    <EffectChangeButton
                                      messages={messages}
                                      code={permission.code}
                                      effect={mapping.effect}
                                      disabled={running}
                                      onChange={(next) =>
                                        void mutate(() =>
                                          changeRolePermissionEffectAction(
                                            roleId,
                                            mapping.id,
                                            mapping.recordVersion as number,
                                            next
                                          )
                                        )
                                      }
                                    />
                                  ) : null}
                                  <Button
                                    type="button"
                                    variant="outlined"
                                    size="small"
                                    color="error"
                                    disabled={running}
                                    aria-label={`${t('permissions.remove')}: ${permission.code}`}
                                    onClick={() => {
                                      setOutcome(IDLE);
                                      setRemoving({ mappingId: mapping.id, code: permission.code });
                                    }}
                                  >
                                    {t('permissions.remove')}
                                  </Button>
                                </>
                              ) : (
                                <>
                                  {(['allow', 'deny'] as const).map((effect) => (
                                    <Button
                                      key={effect}
                                      type="button"
                                      variant="outlined"
                                      size="small"
                                      disabled={running}
                                      aria-label={`${t(`permissions.effect.${effect}`)}: ${permission.code}`}
                                      onClick={() =>
                                        void mutate(() =>
                                          addRolePermissionAction(roleId, permission.code, effect)
                                        )
                                      }
                                    >
                                      {t(`permissions.effect.${effect}`)}
                                    </Button>
                                  ))}
                                </>
                              )}
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            {permissions.some((permission) => permission.riskLevel === 'high') && canManage ? (
              <p className="mt-3 text-caption text-text-muted">
                {t('permissions.escalationWarning')}
              </p>
            ) : null}
          </section>
        ))
      )}

      {removing ? (
        <ConfirmDialog
          open
          destructive
          messages={messages}
          pending={running}
          title={t('permissions.confirm.remove')}
          description={`${removing.code}. ${t('permissions.confirm.removeBody')}`}
          confirmLabel={t('permissions.remove')}
          error={
            refused
              ? translateWithValues(
                  messages,
                  outcome.messageKey ?? 'admin.actionFailed',
                  outcome.messageValues
                )
              : undefined
          }
          onCancel={() => {
            setRemoving(null);
            setOutcome(IDLE);
          }}
          onConfirm={() =>
            void mutate(() => removeRolePermissionAction(roleId, removing.mappingId))
          }
          testId="permissions-remove-confirm"
        />
      ) : null}
    </div>
  );
}

/** Changes an existing mapping to the other effect, named with the permission it acts on. */
function EffectChangeButton({
  messages,
  code,
  effect,
  disabled,
  onChange,
}: {
  readonly messages: Messages;
  readonly code: string;
  readonly effect: 'allow' | 'deny';
  readonly disabled: boolean;
  readonly onChange: (next: 'allow' | 'deny') => void;
}) {
  const next = effect === 'allow' ? 'deny' : 'allow';
  const label = translate(
    messages,
    next === 'allow' ? 'permissions.setAllow' : 'permissions.setDeny'
  );
  return (
    <Button
      type="button"
      variant="outlined"
      size="small"
      disabled={disabled}
      aria-label={`${label}: ${code}`}
      onClick={() => onChange(next)}
    >
      {label}
    </Button>
  );
}

const RISK_TONE: Record<string, string> = {
  low: 'border-border bg-surface-subtle',
  medium: 'border-warning-border bg-warning-subtle',
  high: 'border-error-border bg-error-subtle',
};

function RiskPill({ level, messages }: { readonly level: string; readonly messages: Messages }) {
  const known = level === 'low' || level === 'medium' || level === 'high';
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-caption text-text-primary ${
        RISK_TONE[level] ?? RISK_TONE.low
      }`}
    >
      {/* An unrecognised level is shown verbatim, not mapped to "low". */}
      {known ? translate(messages, `permissions.risk.${level}` as keyof Messages) : level}
    </span>
  );
}
