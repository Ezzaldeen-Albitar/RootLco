'use client';

import { useEffect, useState, useTransition } from 'react';
import { CheckboxField, SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import { readSettings } from '../api';
import type { SettingValueType, SettingView, SettingsScope } from '../types';
import { writeSettingAction } from '../actions';

/**
 * The settings editor.
 *
 * Six screens use this: Organization, numbering rules, taxes, currencies,
 * languages and system settings. Five of them exist *because* the platform
 * publishes no dedicated operation for their subject
 * (`P1-26-F-003` … `P1-26-F-007`), and the approved settings contracts are
 * deliberately decision-neutral — they store the key and value the caller
 * supplies and invent nothing.
 *
 * A screen narrows this editor with a `keyPrefix` and a set of suggested keys.
 * The suggestions are **shape**, not policy: they say where a value is stored,
 * never what it should be. The operator types the value; nothing here defaults
 * one.
 *
 * ## Why the scope identifier is typed rather than chosen from a list
 *
 * There is no company or branch directory operation (`P1-26-F-008`).
 * `GET /api/v1/auth/session` returns bare identifiers, and returns **none** for
 * an unrestricted actor. So the control offers the identifiers the session
 * resolved, and otherwise accepts one.
 *
 * That is not client-authoritative scope. `requireCompanyInScope` runs
 * `assertScopeWithinAuthority` **before** `companyExists`, so an identifier
 * outside the caller's authority is refused identically whether or not it names
 * a real company. Typing one buys no information and no access.
 */

export interface SuggestedKey {
  readonly key: string;
  readonly labelKey: string;
  readonly valueType: SettingValueType;
  readonly hintKey?: string;
}

export function SettingsEditor({
  messages,
  scope,
  scopeIds,
  canWrite,
  keyPrefix,
  suggestions = [],
}: {
  readonly messages: Messages;
  readonly scope: SettingsScope;
  readonly scopeIds: readonly string[];
  readonly canWrite: boolean;
  /** Only keys under this prefix are listed. Empty string lists everything. */
  readonly keyPrefix: string;
  readonly suggestions?: readonly SuggestedKey[];
}) {
  const t = (key: string) => translate(messages, key as keyof Messages);

  const [scopeId, setScopeId] = useState(scopeIds[0] ?? '');
  const [settings, setSettings] = useState<readonly SettingView[] | null>(null);
  const [readStatus, setReadStatus] = useState<'idle' | 'denied' | 'error'>('idle');
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<ActionState>(IDLE);
  const [saving, startSaving] = useTransition();

  const [form, setForm] = useState({
    settingKey: suggestions[0]?.key ?? '',
    valueType: (suggestions[0]?.valueType ?? 'string') as SettingValueType,
    settingValue: '',
    isSensitive: false,
  });

  useEffect(() => {
    let cancelled = false;
    const id = scopeId.trim();
    if (id.length === 0) return undefined;
    void (async () => {
      // Awaited before any state write, so this is not a synchronous setState
      // inside an effect body.
      const result = await readSettings(scope, id);
      if (cancelled) return;
      if (result.status === 'ok') {
        setSettings(result.data ?? []);
        setReadStatus('idle');
      } else {
        setSettings(null);
        setReadStatus(result.status === 'denied' ? 'denied' : 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, scopeId, generation]);

  const visible = (settings ?? []).filter((setting) => setting.settingKey.startsWith(keyPrefix));

  return (
    <div className="flex flex-col gap-5">
      <div className="max-w-md">
        {scopeIds.length > 0 ? (
          <SelectField
            label={t(scope === 'company' ? 'admin.scope.companyId' : 'admin.scope.branchId')}
            description={t('admin.contractGap.noDirectory')}
            value={scopeId}
            onChange={(event) => setScopeId(event.target.value)}
            options={scopeIds.map((id) => ({ value: id, label: id }))}
          />
        ) : (
          <TextField
            label={t(scope === 'company' ? 'admin.scope.companyId' : 'admin.scope.branchId')}
            description={t('admin.scope.noneResolved')}
            value={scopeId}
            spellCheck={false}
            onChange={(event) => setScopeId(event.target.value)}
          />
        )}
      </div>

      {readStatus === 'denied' ? (
        <p role="status" className="text-supporting text-text-secondary">
          {t('state.denied.description')}
        </p>
      ) : null}
      {readStatus === 'error' ? (
        <p role="alert" className="text-supporting text-error">
          {t('state.error.description')}
        </p>
      ) : null}

      {settings !== null ? (
        visible.length === 0 ? (
          <p className="text-body text-text-secondary">{t('state.empty.description')}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border-subtle">
            <table className="w-full border-collapse text-table-cell">
              <caption className="sr-only">{t('organization.settings')}</caption>
              <thead className="border-b border-table-border bg-table-header">
                <tr>
                  <Th>{t('organization.setting.key')}</Th>
                  <Th>{t('organization.setting.value')}</Th>
                  <Th>{t('organization.setting.type')}</Th>
                  <Th>{t('organization.setting.version')}</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((setting) => (
                  <tr key={setting.settingKey} className="border-t border-border-subtle">
                    <td className="px-3 py-2 font-mono text-caption text-text-secondary">
                      {setting.settingKey}
                    </td>
                    <td className="px-3 py-2 text-text-primary">
                      {setting.isSensitive && !('settingValue' in setting) ? (
                        <span className="text-text-muted">
                          {t('organization.setting.withheld')}
                        </span>
                      ) : (
                        <code className="break-all font-mono text-caption">
                          {render(setting.settingValue)}
                        </code>
                      )}
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{setting.valueType}</td>
                    <td className="px-3 py-2 text-end tabular-nums text-text-secondary">
                      {setting.version}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {canWrite ? (
        <form
          className="flex max-w-xl flex-col gap-4 rounded-xl border border-border-subtle p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const id = scopeId.trim();
            if (id.length === 0) return;
            startSaving(async () => {
              const result = await writeSettingAction(scope, id, form);
              setState(result);
              if (result.status === 'success') {
                setForm((current) => ({ ...current, settingValue: '' }));
                setGeneration((value) => value + 1);
              }
            });
          }}
        >
          <p className="text-label font-semibold text-text-primary">
            {t('organization.setting.add')}
          </p>

          <FormFeedback state={state} messages={messages} />

          {suggestions.length > 0 ? (
            <SelectField
              label={t('organization.setting.key')}
              description={t('organization.setting.keyHint')}
              value={form.settingKey}
              onChange={(event) => {
                const chosen = suggestions.find((entry) => entry.key === event.target.value);
                setForm((current) => ({
                  ...current,
                  settingKey: event.target.value,
                  valueType: chosen?.valueType ?? current.valueType,
                }));
              }}
              options={suggestions.map((entry) => ({
                value: entry.key,
                label: `${t(entry.labelKey)} — ${entry.key}`,
              }))}
            />
          ) : (
            <TextField
              label={t('organization.setting.key')}
              description={t('organization.setting.keyHint')}
              value={form.settingKey}
              spellCheck={false}
              onChange={(event) =>
                setForm((current) => ({ ...current, settingKey: event.target.value }))
              }
            />
          )}

          <SelectField
            label={t('organization.setting.type')}
            value={form.valueType}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                valueType: event.target.value as SettingValueType,
              }))
            }
            options={[
              { value: 'string', label: 'string' },
              { value: 'number', label: 'number' },
              { value: 'boolean', label: 'boolean' },
              { value: 'json', label: 'json' },
            ]}
          />

          <TextAreaField
            label={t('organization.setting.value')}
            description={t('organization.setting.valueHint')}
            value={form.settingValue}
            rows={form.valueType === 'json' ? 5 : 2}
            spellCheck={false}
            onChange={(event) =>
              setForm((current) => ({ ...current, settingValue: event.target.value }))
            }
          />

          <CheckboxField
            label={t('organization.setting.sensitive')}
            checked={form.isSensitive}
            onChange={(event) =>
              setForm((current) => ({ ...current, isSensitive: event.target.checked }))
            }
          />

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving || scopeId.trim().length === 0}
              aria-busy={saving || undefined}
              className="rounded-lg bg-primary px-4 py-2 text-button font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? t('admin.saving') : t('admin.save')}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-supporting text-text-muted">{t('admin.readOnly')}</p>
      )}
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

/** Renders a stored value for display. Never parsed back. */
function render(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
