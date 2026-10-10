import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { MuiRefusedState } from '@/components/states/MuiStates';
import { requireSession } from '@/features/authentication/api/session';
import { SettingsEditor } from '@/features/administration/organization/components/SettingsEditor';
import { readReferenceValues } from '@/features/administration/organization/reference-values';
import { MuiContractNotice, Panel } from '@/features/administration/shared/components/ScreenStates';
import { PERMISSIONS, holds } from '@/features/administration/shared/permissions';
import { CURRENCY_RULES } from '@/features/administration/shared/settings-keys';
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
 *
 * On Material UI (ADR-022, P1-32-PRE-OD-ADM5): the editor was migrated by ADM-1;
 * the page frame now draws the platform-scope notice and a page the operator
 * may not read with the shared Material states. The editor stays scoped to the
 * company and branch settings it actually serves; the tenant record is edited
 * on the Organization and Languages screens, and platform settings stay
 * unreachable until an operation publishes them.
 *
 * The general editor can write `currency.enabled_codes` too, so it applies the
 * same check the Currencies screen does (`CURRENCY_RULES`): a malformed or
 * repeated code is refused before anything is sent, and — when the platform's
 * currency list could be read, which takes `org.tenant.read` — so is a code the
 * platform does not hold. That list is read only for an operator who may write.
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
          <MuiRefusedState messages={messages} testId="settings-screen-refused" />
        </PageBody>
      </>
    );
  }

  const canWrite = holds(session.permissions, PERMISSIONS.settingsManage);
  const references =
    canWrite && holds(session.permissions, PERMISSIONS.tenantRead)
      ? await readReferenceValues()
      : null;
  const knownCodes = references ? references.currencies.map((currency) => currency.code) : null;

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
          {/*
            The "no company or branch directory" half of this notice was
            removed, because it stopped being true: the settings panels below
            choose a company or a branch BY NAME from the working context.
            A standing notice describing a limit the product no longer has is
            not caution, it is a false statement about the screen the operator
            is looking at. The platform-scope sentence stays — that limit is
            real.
          */}
          <MuiContractNotice messages={messages} bodyKeys={['systemSettings.noPlatformScope']} />

          {canReadCompany ? (
            <Panel title={t('organization.settings.company')}>
              <SettingsEditor
                messages={messages}
                scope="company"
                canWrite={canWrite}
                keyPrefix=""
                valueRules={CURRENCY_RULES}
                knownCodes={knownCodes}
              />
            </Panel>
          ) : null}

          {canReadBranch ? (
            <Panel title={t('organization.settings.branch')}>
              <SettingsEditor
                messages={messages}
                scope="branch"
                canWrite={canWrite}
                keyPrefix=""
                valueRules={CURRENCY_RULES}
                knownCodes={knownCodes}
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
