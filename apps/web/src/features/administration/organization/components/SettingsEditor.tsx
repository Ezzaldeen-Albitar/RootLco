'use client';

import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { FormCheckboxField } from '@/components/forms/mui/FormCheckboxField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { MuiEmptyState, MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { IDLE, invalid, unreachable, type ActionState } from '@/lib/forms/action-result';
import { FormFeedback } from '@/features/authentication/components/FormFeedback';
import { DirectoryEmptyNotice } from '@/features/working-context/components/WorkingBranchField';
import {
  useUnsavedGuard,
  useWorkingContext,
} from '@/features/working-context/WorkingContextProvider';
import { readSettings } from '../api';
import type { SettingValueType, SettingView, SettingsScope } from '../types';
import { writeSettingAction } from '../actions';
import { useHeldRefusal } from '@/lib/forms/use-local-refusal';
import { useSingleFlight } from './use-single-flight';

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
 *
 * ## On Material UI (ADR-022, P1-32-PRE-OD-ADM1)
 *
 * The scope, the setting, its kind and its value are the Material form fields;
 * the sensitive mark is `FormCheckboxField`; the stored settings are Material's
 * table (one bounded read, no cursor); a read that did not answer is the shared
 * Material state, with Try again where trying again can help. The kind of value
 * is said in words ("Text", "Yes or no"), never as the stored type name. A
 * value typed and not saved — or a key, kind or sensitive mark changed from
 * where the form started — is unsaved work: leaving the page or changing branch
 * asks first, and discarding puts the form back. One write at a time
 * (`useSingleFlight`). The screens that use this editor (Organisation, system
 * settings, numbering rules, taxes, currencies) pass the same props as before.
 */

export interface SuggestedKey {
  readonly key: string;
  readonly labelKey: string;
  readonly valueType: SettingValueType;
  readonly hintKey?: string;
}

/**
 * A check a key's value must pass before anything is sent, and the sentence said
 * under the value box while that key is chosen (P1-32-PRE-OD-ADM5). Data, not a
 * function, because it crosses from a Server Component. Kept apart from
 * `SuggestedKey` on purpose: a suggestion is only where a value lives.
 *
 *   - `currency-codes` — a list of distinct three-letter codes, each one the
 *     platform holds when its currency list was read (`knownCodes`).
 */
export interface ValueRule {
  readonly rule: 'currency-codes';
  readonly hintKey: string;
}

/** A stable empty set, so the refusal hook sees no new attempt on every render. */
const NO_ERRORS: Readonly<Record<string, string>> = Object.freeze({});
/** No key carries a rule unless the screen says so. */
const NO_RULES: Readonly<Record<string, ValueRule>> = Object.freeze({});

export function SettingsEditor({
  messages,
  scope,
  canWrite,
  keyPrefix,
  suggestions = [],
  readOnlyKey = 'admin.readOnly',
  valueRules = NO_RULES,
  knownCodes = null,
}: {
  readonly messages: Messages;
  readonly scope: SettingsScope;
  readonly canWrite: boolean;
  /** Only keys under this prefix are listed. Empty string lists everything. */
  readonly keyPrefix: string;
  readonly suggestions?: readonly SuggestedKey[];
  /**
   * The sentence in place of the form when nothing is written here. The default
   * is the permission sentence; a screen that shows settings it has no operation
   * to apply says that instead (P1-32-PRE-OD-ADM5).
   */
  readonly readOnlyKey?: string;
  /** Checks on the values of particular keys, by key. */
  readonly valueRules?: Readonly<Record<string, ValueRule>>;
  /** The currency codes the platform holds, for a `currency-codes` rule; null when not read. */
  readonly knownCodes?: readonly string[] | null;
}) {
  const t = (key: string) => translate(messages, key as keyof Messages);

  /*
   * The companies or branches this operator may act in, by name.
   *
   * Branches are labelled with their company, because two workshops in one
   * organisation may share a name and the operator has to be able to tell them
   * apart without reading a reference.
   */
  const { companies, branches, companySettingsReadableIds } = useWorkingContext();
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
  const [readStatus, setReadStatus] = useState<'idle' | 'denied' | 'unavailable' | 'error'>('idle');
  const [readCorrelation, setReadCorrelation] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<ActionState>(IDLE);
  const saving = useSingleFlight();

  const initialForm: SettingForm = {
    settingKey: suggestions[0]?.key ?? '',
    valueType: suggestions[0]?.valueType ?? 'string',
    settingValue: '',
    isSensitive: false,
  };
  const [form, setForm] = useState<SettingForm>(initialForm);
  // Where the form "started": the first suggestion until a save, then what that
  // save stored (with the value box emptied). Unsaved work is measured against
  // this, so a saved key, kind or sensitive mark is not mistaken for unsaved work.
  const [baseline, setBaseline] = useState<SettingForm>(initialForm);
  // Question f: the cursor goes to the refused value, and its complaint goes once
  // the value changes (route sweep B3).
  const { errors: refusalErrors, formRef: refusalFormRef } = useHeldRefusal(
    state.fieldErrors ?? NO_ERRORS,
    { settingValue: form.settingValue }
  );
  // Typed and not saved is work a page change or a branch change would throw
  // away, so it asks first; a confirmed discard puts the form back.
  const dirty =
    canWrite &&
    (form.settingValue !== '' ||
      form.settingKey !== baseline.settingKey ||
      form.valueType !== baseline.valueType ||
      form.isSensitive !== baseline.isSensitive);
  useUnsavedGuard(dirty, () => {
    setForm(baseline);
    setState(IDLE);
  });

  /*
   * A company's settings are read only where the server said the read would be
   * answered. Holding `org.company.read` is not enough: held through a branch
   * grant (the counter clerk) it passes the session's codes and is refused by
   * `iam.company-settings-read` on every load. The working context publishes the
   * companies the read would answer for, decided by the same checks the read
   * enforces, so for any other company no request is made and the screen says so
   * plainly instead of reporting a refusal.
   */
  const selectedId = scopeId.trim();
  const unreadableCompany =
    scope === 'company' &&
    selectedId.length > 0 &&
    !companySettingsReadableIds.includes(selectedId);

  useEffect(() => {
    let cancelled = false;
    const id = scopeId.trim();
    if (id.length === 0 || unreadableCompany) return undefined;
    void (async () => {
      // Awaited before any state write, so this is not a synchronous setState
      // inside an effect body.
      const result = await readSettings(scope, id);
      if (cancelled) return;
      setReadCorrelation(result.correlationId);
      if (result.status === 'ok') {
        setSettings(result.data ?? []);
        setReadStatus('idle');
      } else {
        setSettings(null);
        setReadStatus(
          result.status === 'denied'
            ? 'denied'
            : result.status === 'unavailable'
              ? 'unavailable'
              : 'error'
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, scopeId, generation, unreadableCompany]);

  const visible = (settings ?? []).filter((setting) => setting.settingKey.startsWith(keyPrefix));
  const reading =
    selectedId.length > 0 && !unreadableCompany && settings === null && readStatus === 'idle';
  const chosenHint =
    valueRules[form.settingKey]?.hintKey ??
    suggestions.find((entry) => entry.key === form.settingKey)?.hintKey;
  const typeLabel = (type: string) =>
    VALUE_TYPES.includes(type as SettingValueType)
      ? t(`organization.setting.kind.${type}`)
      : t('organization.setting.kind.unknown');

  return (
    <div className="flex flex-col gap-5">
      <div className="max-w-md">
        {scopeOptions.length > 0 ? (
          <FormSelectField
            label={t(scope === 'company' ? 'admin.scope.company' : 'admin.scope.branch')}
            required
            value={scopeId}
            onChange={setScopeId}
            options={scopeOptions}
            placeholder={t('form.select.placeholder')}
          />
        ) : (
          // Nothing to choose, or the directory could not be read. Saying which
          // is the honest answer; a box asking for a typed reference was not.
          <DirectoryEmptyNotice
            messages={messages}
            fallbackKey={
              scope === 'company' ? 'workingContext.noCompany' : 'workingContext.noBranch'
            }
          />
        )}
      </div>

      {unreadableCompany ? (
        <p
          role="status"
          data-testid="company-settings-not-readable"
          className="text-supporting text-text-secondary"
        >
          {t('organization.settings.companyNotReadable')}
        </p>
      ) : null}
      {!unreadableCompany && readStatus !== 'idle' ? (
        <MuiReadFailureState
          messages={messages}
          status={readStatus}
          correlationId={readCorrelation}
          onRetry={() => {
            setReadStatus('idle');
            setGeneration((value) => value + 1);
          }}
        />
      ) : null}
      {reading ? <MuiLoadingState messages={messages} variant="inline" /> : null}

      {settings !== null && !unreadableCompany ? (
        visible.length === 0 ? (
          <MuiEmptyState messages={messages} />
        ) : (
          <TableContainer className="rounded-xl border border-border-subtle">
            <Table size="small" aria-label={t('organization.settings')}>
              <TableHead>
                <TableRow>
                  <TableCell>{t('organization.setting.key')}</TableCell>
                  <TableCell>{t('organization.setting.value')}</TableCell>
                  <TableCell>{t('organization.setting.type')}</TableCell>
                  <TableCell className="text-end">{t('organization.setting.version')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map((setting) => (
                  <TableRow key={setting.settingKey}>
                    <TableCell className="font-mono text-caption">
                      <span dir="ltr">{setting.settingKey}</span>
                    </TableCell>
                    <TableCell>
                      {setting.isSensitive && !('settingValue' in setting) ? (
                        <span className="text-text-muted">
                          {t('organization.setting.withheld')}
                        </span>
                      ) : (
                        <code className="break-all font-mono text-caption" dir="ltr">
                          {render(setting.settingValue)}
                        </code>
                      )}
                    </TableCell>
                    <TableCell>{typeLabel(setting.valueType)}</TableCell>
                    <TableCell className="text-end tabular-nums">{setting.version}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
      ) : null}

      {canWrite ? (
        <form
          ref={refusalFormRef}
          noValidate
          className="flex max-w-xl flex-col gap-4 rounded-xl border border-border-subtle p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const id = scopeId.trim();
            if (id.length === 0) return;
            const input = form;
            const previous = state;
            // A value the chosen key's rule refuses is refused beside its box,
            // and nothing is sent.
            const ruleError = ruleRefusal(valueRules[input.settingKey.trim()], input, knownCodes);
            if (ruleError !== null) {
              setState(invalid({ settingValue: ruleError }, (previous.attempt ?? 0) + 1));
              return;
            }
            saving.run(async () => {
              let result: ActionState;
              try {
                result = await writeSettingAction(scope, id, input);
              } catch {
                // Numbered from the attempt before it, so a second failure in a
                // row is a fresh announcement rather than the same one kept.
                result = unreachable((previous.attempt ?? 0) + 1);
              }
              setState(result);
              if (result.status === 'success') {
                setForm((current) => ({ ...current, settingValue: '' }));
                setBaseline({ ...input, settingValue: '' });
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
            <FormSelectField
              label={t('organization.setting.key')}
              description={t('organization.setting.keyHint')}
              value={form.settingKey}
              onChange={(value) => {
                const chosen = suggestions.find((entry) => entry.key === value);
                setForm((current) => ({
                  ...current,
                  settingKey: value,
                  valueType: chosen?.valueType ?? current.valueType,
                }));
              }}
              options={suggestions.map((entry) => ({
                value: entry.key,
                label: `${t(entry.labelKey)} — ${entry.key}`,
              }))}
            />
          ) : (
            <FormTextField
              label={t('organization.setting.key')}
              description={t('organization.setting.keyHint')}
              value={form.settingKey}
              spellCheck={false}
              dir="ltr"
              onChange={(value) => setForm((current) => ({ ...current, settingKey: value }))}
              error={refusalErrors['settingKey'] ? t(refusalErrors['settingKey']) : undefined}
            />
          )}

          <FormSelectField
            label={t('organization.setting.type')}
            value={form.valueType}
            onChange={(value) =>
              setForm((current) => ({ ...current, valueType: value as SettingValueType }))
            }
            options={VALUE_TYPES.map((type) => ({ value: type, label: typeLabel(type) }))}
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
          <FormTextField
            label={t('organization.setting.value')}
            description={t(chosenHint ?? 'organization.setting.valueHint')}
            value={form.settingValue}
            multiline
            rows={form.valueType === 'json' ? 5 : 2}
            spellCheck={false}
            onChange={(value) => setForm((current) => ({ ...current, settingValue: value }))}
            error={refusalErrors['settingValue'] ? t(refusalErrors['settingValue']) : undefined}
          />

          <FormCheckboxField
            label={t('organization.setting.sensitive')}
            checked={form.isSensitive}
            onChange={(checked) => setForm((current) => ({ ...current, isSensitive: checked }))}
          />

          <div className="flex justify-end">
            <Button
              type="submit"
              variant="contained"
              disabled={saving.pending || scopeId.trim().length === 0}
              aria-busy={saving.pending || undefined}
            >
              {saving.pending ? t('admin.saving') : t('admin.save')}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-supporting text-text-muted" data-testid="settings-read-only">
          {t(readOnlyKey)}
        </p>
      )}
    </div>
  );
}

interface SettingForm {
  readonly settingKey: string;
  readonly valueType: SettingValueType;
  readonly settingValue: string;
  readonly isSensitive: boolean;
}

/** The kinds a setting may declare, in the order the select offers them. */
const VALUE_TYPES: readonly SettingValueType[] = ['string', 'number', 'boolean', 'json'];

const CURRENCY_CODE = /^[A-Z]{3}$/;

/**
 * The catalogue key of what a suggestion's rule refuses in this value, or null.
 *
 * `currency-codes`: a list of distinct three-letter codes, stored as a
 * structured value so the Organisation screen can read it back as a list
 * (`readCurrencyChoices`). When the platform's currency list was read, each code
 * must be one it holds; when it was not, the shape is all that can be checked,
 * and nothing is refused for a list the screen does not have.
 */
function ruleRefusal(
  valueRule: ValueRule | undefined,
  form: SettingForm,
  knownCodes: readonly string[] | null
): string | null {
  if (valueRule?.rule !== 'currency-codes') return null;
  if (form.valueType !== 'json') return 'currencies.error.list';
  let parsed: unknown;
  try {
    parsed = JSON.parse(form.settingValue);
  } catch {
    return 'currencies.error.list';
  }
  if (!Array.isArray(parsed)) return 'currencies.error.list';
  const seen = new Set<string>();
  for (const code of parsed as unknown[]) {
    if (typeof code !== 'string' || !CURRENCY_CODE.test(code)) return 'currencies.error.code';
    if (seen.has(code)) return 'currencies.error.duplicate';
    seen.add(code);
    if (knownCodes !== null && !knownCodes.includes(code)) return 'currencies.error.notHeld';
  }
  return null;
}

/** Renders a stored value for display. Never parsed back. */
function render(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
