'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { SelectField } from '@/components/forms/Field';
import { ConfirmDialog } from '@/components/overlays/Overlays';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import { readPermissionCatalogue } from '../api';
import type { PermissionRow, RolePermissionRow, RoleRow } from '../types';
import { addRolePermissionAction, removeRolePermissionAction } from '../actions';

/**
 * The permission catalogue, and what one role does with it.
 *
 * ## The notice at the top is the point of the screen
 *
 * "What you see here is a convenience. Every request is checked by the service,
 * and its decision is the one that applies." An administration screen that lists
 * permissions invites the belief that this list *is* the access control. It is
 * not; it is a view of `iam.role_permissions`, and the database decides.
 *
 * ## Escalation
 *
 * `assertDelegable` refuses a permission the actor does not itself hold, and the
 * refusal arrives as a denial from the server. This screen warns before a
 * high-risk grant — advice, ahead of an authoritative answer — and does not
 * duplicate the rule. A second implementation of an authorization check is a
 * second place for it to be wrong, and this is the copy with no database behind
 * it.
 */
export function PermissionsScreen({
  messages,
  roles,
  canManage,
}: {
  readonly messages: Messages;
  readonly roles: readonly RoleRow[];
  readonly canManage: boolean;
}) {
  const t = (key: string) => translate(messages, key as keyof Messages);

  const [roleId, setRoleId] = useState<string>(roles[0]?.id ?? '');
  const [generation, setGeneration] = useState(0);
  const [held, setHeld] = useState<{
    readonly key: string;
    readonly permissions: readonly PermissionRow[];
    readonly mappings: readonly RolePermissionRow[];
    readonly status: string;
  } | null>(null);
  const [state, setState] = useState<ActionState>(IDLE);
  const [removing, setRemoving] = useState<{
    readonly mappingId: string;
    readonly code: string;
  } | null>(null);
  const [running, start] = useTransition();

  const wanted = `${roleId}#${generation}`;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await readPermissionCatalogue(roleId || null);
      if (cancelled) return;
      setHeld({
        key: wanted,
        permissions: result.permissions,
        mappings: result.mappings,
        status: result.status,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [wanted, roleId]);

  const loading = held === null || held.key !== wanted;
  const selectedRole = roles.find((role) => role.id === roleId) ?? null;

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

  const mutate = (task: () => Promise<ActionState>) => {
    start(async () => {
      const result = await task();
      setState(result);
      if (result.status === 'success') {
        setRemoving(null);
        setGeneration((value) => value + 1);
      }
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="rounded-lg border border-info-border bg-info-subtle p-3 text-supporting text-text-secondary">
        {t('permissions.visibilityNotice')}
      </p>

      <FormFeedback state={state} messages={messages} />

      <div className="max-w-md">
        <SelectField
          label={t('permissions.selectRole')}
          description={t('permissions.selectRoleHint')}
          value={roleId}
          onChange={(event) => setRoleId(event.target.value)}
          options={roles.map((role) => ({ value: role.id, label: role.name }))}
          placeholder={roles.length === 0 ? t('field.selectPlaceholder') : undefined}
        />
      </div>

      {selectedRole?.isSystem ? (
        <p role="status" className="text-supporting text-text-secondary">
          {t('roles.systemLocked')}
        </p>
      ) : null}

      {loading ? (
        <p role="status" className="text-body text-text-muted">
          {t('state.loading')}
        </p>
      ) : (
        grouped.map(([domain, permissions]) => (
          <section key={domain} className="rounded-xl border border-border-subtle bg-surface p-4">
            <h3 className="text-label font-semibold uppercase tracking-wide text-text-muted">
              {domain}
            </h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-table-cell">
                <caption className="sr-only">{`${t('permissions.title')} — ${domain}`}</caption>
                <thead className="border-b border-table-border bg-table-header">
                  <tr>
                    <Th>{t('permissions.column.code')}</Th>
                    <Th>{t('column.description')}</Th>
                    <Th>{t('permissions.column.risk')}</Th>
                    <Th>{t('permissions.column.effect')}</Th>
                    <Th>{t('admin.actions')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {permissions.map((permission) => {
                    const mapping = byCode.get(permission.code);
                    return (
                      <tr key={permission.id} className="border-t border-border-subtle">
                        <td className="px-3 py-2 font-mono text-caption text-text-secondary">
                          {permission.code}
                        </td>
                        <td className="px-3 py-2 text-text-primary">{permission.description}</td>
                        <td className="px-3 py-2">
                          <RiskPill level={permission.riskLevel} messages={messages} />
                        </td>
                        <td className="px-3 py-2">
                          {mapping ? (
                            <span
                              className={
                                mapping.effect === 'allow' ? 'text-success' : 'text-error'
                              }
                            >
                              {t(`permissions.effect.${mapping.effect}`)}
                            </span>
                          ) : (
                            <span className="text-text-muted">{t('permissions.effect.unset')}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-end">
                          {canManage && roleId && !selectedRole?.isSystem ? (
                            mapping ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setRemoving({ mappingId: mapping.id, code: permission.code })
                                }
                                className="rounded-md border border-border px-2 py-1 text-caption text-text-secondary hover:bg-surface-subtle"
                              >
                                {t('permissions.remove')}
                              </button>
                            ) : (
                              <div className="flex justify-end gap-1">
                                <button
                                  type="button"
                                  disabled={running}
                                  onClick={() =>
                                    mutate(() =>
                                      addRolePermissionAction(roleId, permission.code, 'allow')
                                    )
                                  }
                                  className="rounded-md border border-border px-2 py-1 text-caption text-text-secondary hover:bg-surface-subtle disabled:cursor-not-allowed"
                                >
                                  {t('permissions.effect.allow')}
                                </button>
                                <button
                                  type="button"
                                  disabled={running}
                                  onClick={() =>
                                    mutate(() =>
                                      addRolePermissionAction(roleId, permission.code, 'deny')
                                    )
                                  }
                                  className="rounded-md border border-border px-2 py-1 text-caption text-text-secondary hover:bg-surface-subtle disabled:cursor-not-allowed"
                                >
                                  {t('permissions.effect.deny')}
                                </button>
                              </div>
                            )
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
          description={t('permissions.confirm.removeBody')}
          confirmLabel={t('permissions.remove')}
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            mutate(() => removeRolePermissionAction(roleId, removing.mappingId))
          }
        />
      ) : null}
    </div>
  );
}

function Th({ children }: { readonly children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-3 py-2 text-start text-table-header font-semibold uppercase tracking-wide text-table-header-text"
    >
      {children}
    </th>
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
