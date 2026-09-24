'use client';

import { useEffect, useState, useTransition } from 'react';
import { CheckboxField, SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import { RequiresConcreteBranch } from '@/features/working-context/components/WorkingBranchField';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import { readSettings } from '../api';
import type { SettingValueType, SettingView, SettingsScope } from '../types';
import { writeSettingAction } from '../actions';
import { useHeldRefusal } from '@/lib/forms/use-local-refusal';

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
 * ## The scope is CHOSEN BY NAME, and this paragraph used to say it could not be
 *
 * It read: "There is no company or branch directory operation (`P1-26-F-008`).
 * `GET /api/v1/auth/session` returns bare identifiers, and returns none for an
 * unrestricted actor. So the control offers the identifiers the session
 * resolved, and otherwise accepts one." Both halves were true and both have
 * been answered. `GET /auth/working-context` publishes the named, active
 * companies and branches the caller is authorized for, and states
 * `unrestricted` explicitly instead of leaving an empty list to mean it — so
 * the operator with the widest reach is no longer the one handed a box and
 * asked to type a reference they have to find somewhere else.
 *
 * What has NOT changed is where authority lives. The chosen reference is still
 * sent and still re-authorized: `requireCompanyInScope` runs
 * `assertScopeWithinAuthority` **before** `companyExists`, so a reference
 * outside the caller's authority is refused identically whether or not it names
 * a real company. Offering names buys the operator legibility, not access.
 */

export interface SuggestedKey {
  readonly key: string;
  readonly labelKey: string;
  readonly valueType: SettingValueType;
  readonly hintKey?: string;
}

/** A stable empty set, so the refusal hook sees no new attempt on every render. */
const NO_ERRORS: Readonly<Record<string, string>> = Object.freeze({});

export function SettingsEditor({
  messages,
  scope,
  canWrite,
  keyPrefix,
  suggestions = [],
}: {
  readonly messages: Messages;
  readonly scope: SettingsScope;
  readonly canWrite: boolean;
  /** Only keys under this prefix are listed. Empty string lists everything. */
  readonly keyPrefix: string;
  readonly suggestions?: readonly SuggestedKey[];
}) {
  const t = (key: string) => translate(messages, key as keyof Messages);

  /*
   * The companies or branches this operator may act in, by name.
   *
   * Branches are labelled with their company, because two workshops in one
   * organisation may share a name and the operator has to be able to tell them
   * apart without reading a reference.
   */
  const { companies, branches } = useWorkingContext();
  const scopeOptions =
    scope === 'company'
      ? companies.map((company) => ({ value: company.id, label: company.name }))
      : branches.map((branch) => {
          const owner = companies.find((company) => company.id === branch.companyId);
          return {
            value: branch.id,
            label: owner === undefined ? branch.name : `${branch.name} · ${owner.name}`,
          };
        });

  const [scopeId, setScopeId] = useState(scopeOptions[0]?.value ?? '');
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
  // Question f: the cursor goes to the refused value, and its complaint goes once
  // the value changes (route sweep B3).
  const { errors: refusalErrors, formRef: refusalFormRef } = useHeldRefusal(
    state.fieldErrors ?? NO_ERRORS,
    { settingValue: form.settingValue }
  );

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
        {scopeOptions.length > 0 ? (
          <SelectField
            label={t(scope === 'company' ? 'admin.scope.company' : 'admin.scope.branch')}
            required
            value={scopeId}
            onChange={(event) => setScopeId(event.target.value)}
            options={scopeOptions}
            placeholder={t('form.select.placeholder')}
          />
        ) : (
          // Nothing to choose, or the directory could not be read. Saying which
          // is the honest answer; a box asking for a typed reference was not.
          <RequiresConcreteBranch
            messages={messages}
            fallbackKey={
              scope === 'company' ? 'workingContext.noCompany' : 'workingContext.noBranch'
            }
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
          ref={refusalFormRef}
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

          {/*
            The refusal about this box belongs beside this box.

            Both refusals it can earn name `settingValue`: the local one, when
            the text does not read as the kind of value chosen above, and the
            server's, when the stored setting refuses the value against its own
            declared kind. Neither was rendered anywhere — the banner shows the
            whole-request sentence only — so an operator was refused with nothing
            beside the control they had to change, and what they had typed stayed
            in the box with no mark on it.
          */}
          <TextAreaField
            label={t('organization.setting.value')}
            description={t('organization.setting.valueHint')}
            value={form.settingValue}
            rows={form.valueType === 'json' ? 5 : 2}
            spellCheck={false}
            onChange={(event) =>
              setForm((current) => ({ ...current, settingValue: event.target.value }))
            }
            error={refusalErrors['settingValue'] ? t(refusalErrors['settingValue']) : undefined}
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
