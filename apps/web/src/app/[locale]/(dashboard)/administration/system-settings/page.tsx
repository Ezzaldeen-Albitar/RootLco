import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { SettingsEditor } from '@/features/administration/organization/components/SettingsEditor';
import { ContractNotice, Panel } from '@/features/administration/shared/components/ScreenStates';
import { PERMISSIONS, holds } from '@/features/administration/shared/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages, translate, type Messages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * System settings.
 *
 * The three settings surfaces the platform actually publishes, at the two scopes
 * this screen can address. `shared.system_settings` carries a `scope` column for
 * platform-wide configuration and **no route handler exposes it**
 * (`P1-26-F-007`), so the page says that rather than leaving an operator hunting
 * for a level that is not reachable from here.
 *
 * No key prefix and no suggestions: this is the general editor. The named
 * screens — numbering, taxes, currencies — are the same editor narrowed, and
 * anything they write is visible here too, which is the correct relationship
 * between a specific view and the general one.
 */
export default async function SystemSettingsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages: Messages = getMessages(locale);
  const t = (key: string) => translate(messages, key as keyof Messages);

  const crumbs = [
    { labelKey: 'nav.administration', href: `/${locale}/administration` },
    { labelKey: 'nav.systemSettings' },
  ];

  const canReadCompany = holds(session.permissions, PERMISSIONS.companyRead);
  const canReadBranch = holds(session.permissions, PERMISSIONS.branchRead);

  if (!canReadCompany && !canReadBranch) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="systemSettings.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const canWrite = holds(session.permissions, PERMISSIONS.settingsManage);

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="systemSettings.title"
        descriptionKey="systemSettings.description"
        crumbs={crumbs}
      />
      <PageBody>
        <div className="flex flex-col gap-6">
          <ContractNotice
            messages={messages}
            bodyKeys={['systemSettings.noPlatformScope', 'admin.contractGap.noDirectory']}
          />

          {canReadCompany ? (
            <Panel title={t('organization.settings.company')}>
              <SettingsEditor
                messages={messages}
                scope="company"
                scopeIds={session.companyIds}
                canWrite={canWrite}
                keyPrefix=""
              />
            </Panel>
          ) : null}

          {canReadBranch ? (
            <Panel title={t('organization.settings.branch')}>
              <SettingsEditor
                messages={messages}
                scope="branch"
                scopeIds={session.branchIds}
                canWrite={canWrite}
                keyPrefix=""
              />
            </Panel>
          ) : null}
        </div>
      </PageBody>
    </>
  );
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('systemSettings.title');
