import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import type { SessionSummary } from '@/features/authentication/types/session';
import { SettingsEditor, type SuggestedKey } from '../../organization/components/SettingsEditor';
import type { Locale } from '@/i18n/config';
import { getMessages, translate, type Messages } from '@/i18n/get-messages';
import { PERMISSIONS, holds } from '../permissions';
import { ContractNotice, Panel } from './ScreenStates';

/**
 * The screen shape shared by numbering rules, taxes and currencies.
 *
 * Three screens with the same structure: a notice saying plainly that the
 * platform publishes no dedicated operation for this subject, then a
 * settings editor narrowed to the keys that subject uses.
 *
 * They are one component because they are one screen with three configurations.
 * Copying it three times is how the notice ends up worded differently in each,
 * and how one of them quietly stops saying it at all.
 */
export function SettingsBackedScreen({
  locale,
  session,
  titleKey,
  descriptionKey,
  navLabelKey,
  keyPrefix,
  suggestions,
  noticeKeys,
}: {
  readonly locale: Locale;
  readonly session: SessionSummary;
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly navLabelKey: string;
  readonly keyPrefix: string;
  readonly suggestions: readonly SuggestedKey[];
  readonly noticeKeys: readonly string[];
}) {
  const messages: Messages = getMessages(locale);
  const t = (key: string) => translate(messages, key as keyof Messages);

  const crumbs = [
    { labelKey: 'nav.administration', href: `/${locale}/administration` },
    { labelKey: navLabelKey },
  ];

  // The read permission for company settings. Without it the editor would show
  // an empty list, which reads as "nothing is configured" rather than "you may
  // not see it" — and those are different facts.
  if (!holds(session.permissions, PERMISSIONS.companyRead)) {
    return (
      <>
        <PageHeader locale={locale} messages={messages} titleKey={titleKey} crumbs={crumbs} />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

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
          <ContractNotice
            messages={messages}
            bodyKeys={['admin.contractGap.settingsBacked', ...noticeKeys]}
          />
          <Panel title={t('organization.settings.company')}>
            <SettingsEditor
              messages={messages}
              scope="company"
              scopeIds={session.companyIds}
              canWrite={holds(session.permissions, PERMISSIONS.settingsManage)}
              keyPrefix={keyPrefix}
              suggestions={suggestions}
            />
          </Panel>
        </div>
      </PageBody>
    </>
  );
}
