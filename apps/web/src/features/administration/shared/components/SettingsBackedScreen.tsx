import type { ReactNode } from 'react';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { MuiRefusedState } from '@/components/states/MuiStates';
import type { SessionSummary } from '@/features/authentication/types/session';
import {
  SettingsEditor,
  type SuggestedKey,
  type ValueRule,
} from '../../organization/components/SettingsEditor';
import type { SettingsScope } from '../../organization/types';
import type { Locale } from '@/i18n/config';
import { getMessages, translate, type Messages } from '@/i18n/get-messages';
import { PERMISSIONS, holds } from '../permissions';
import { MuiContractNotice, Panel } from './ScreenStates';

/**
 * The screen shape shared by numbering rules, taxes and currencies.
 *
 * Three screens with the same structure: a notice saying plainly what the
 * platform does not publish for this subject, then the settings the settings
 * operations genuinely hold under the subject's keys.
 *
 * They are one component because they are one screen with three configurations.
 * Copying it three times is how the notice ends up worded differently in each,
 * and how one of them quietly stops saying it at all.
 *
 * ## On Material UI, with the gaps said rather than decorated (P1-32-PRE-OD-ADM5)
 *
 *   - `writable` — whether this screen writes. Currencies does: the enabled
 *     codes are read back by the Organisation screen. Numbering rules and taxes
 *     do NOT: nothing in the platform applies a numbering or tax setting to a
 *     document (`P1-26-F-003`, `P1-26-F-004`), so a form there would be an edit
 *     control for an operation that does not exist. They show what is stored,
 *     and say why nothing is changed here.
 *   - `scopes` — which settings are shown: the company's, and the branch's
 *     where the screen asks for them, each only for a holder of the read code
 *     its operation declares (`org.company.read`, `org.branch.read`).
 *   - `lead` — a panel before the settings (the platform's currency list), with
 *     `leadReadable` saying whether the operator may read it at all.
 *
 * The page is refused as a whole only when the operator may read none of it;
 * otherwise each panel they may read is shown, and a panel they may not is left
 * out rather than drawn empty, because "nothing is configured" and "you may not
 * see it" are different facts.
 */
/** No key carries a value rule unless the screen passes one. */
const NO_RULES: Readonly<Record<string, ValueRule>> = Object.freeze({});

export function SettingsBackedScreen({
  locale,
  session,
  titleKey,
  descriptionKey,
  navLabelKey,
  keyPrefix,
  suggestions,
  noticeKeys,
  writable = true,
  scopes = ['company'],
  lead,
  leadReadable = false,
  valueRules = NO_RULES,
  knownCodes = null,
}: {
  readonly locale: Locale;
  readonly session: SessionSummary;
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly navLabelKey: string;
  readonly keyPrefix: string;
  readonly suggestions: readonly SuggestedKey[];
  readonly noticeKeys: readonly string[];
  readonly writable?: boolean;
  readonly scopes?: readonly SettingsScope[];
  readonly lead?: ReactNode;
  readonly leadReadable?: boolean;
  readonly valueRules?: Readonly<Record<string, ValueRule>>;
  readonly knownCodes?: readonly string[] | null;
}) {
  const messages: Messages = getMessages(locale);
  const t = (key: string) => translate(messages, key as keyof Messages);

  const crumbs = [
    { labelKey: 'nav.administration', href: `/${locale}/administration` },
    { labelKey: navLabelKey },
  ];

  const readable: Record<SettingsScope, boolean> = {
    company: scopes.includes('company') && holds(session.permissions, PERMISSIONS.companyRead),
    branch: scopes.includes('branch') && holds(session.permissions, PERMISSIONS.branchRead),
  };

  // Nothing on the page may be read: say so instead of drawing empty panels.
  if (!readable.company && !readable.branch && !(lead !== undefined && leadReadable)) {
    return (
      <>
        <PageHeader locale={locale} messages={messages} titleKey={titleKey} crumbs={crumbs} />
        <PageBody>
          <MuiRefusedState messages={messages} testId="settings-screen-refused" />
        </PageBody>
      </>
    );
  }

  const canWrite = writable && holds(session.permissions, PERMISSIONS.settingsManage);
  const notice = writable
    ? ['admin.contractGap.settingsBacked', ...noticeKeys]
    : [...noticeKeys, 'admin.contractGap.settingsShownOnly'];

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey={titleKey}
        descriptionKey={descriptionKey}
        crumbs={crumbs}
      />
      <PageBody>
        <div className="flex flex-col gap-6">
          <MuiContractNotice messages={messages} bodyKeys={notice} />
          {lead !== undefined && leadReadable ? lead : null}
          {scopes.map((scope) =>
            readable[scope] ? (
              <Panel
                key={scope}
                title={t(
                  scope === 'company'
                    ? 'organization.settings.company'
                    : 'organization.settings.branch'
                )}
              >
                <SettingsEditor
                  messages={messages}
                  scope={scope}
                  canWrite={canWrite}
                  keyPrefix={keyPrefix}
                  suggestions={suggestions}
                  readOnlyKey={writable ? 'admin.readOnly' : 'admin.contractGap.notChangedHere'}
                  valueRules={valueRules}
                  knownCodes={knownCodes}
                />
              </Panel>
            ) : null
          )}
        </div>
      </PageBody>
    </>
  );
}
