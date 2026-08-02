import { notFound } from 'next/navigation';
import { GalleryClient } from '@/components/gallery/GalleryClient';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { galleryEnabled } from '@/lib/gallery-access';

/**
 * The component gallery route.
 *
 * Gated by `galleryEnabled()` rather than by a bundler condition, so the rule is
 * one function with one test rather than a build flag nobody can assert on.
 */
/**
 * Rendered per REQUEST, not prerendered.
 *
 * P1-25-F-018: the route was statically generated, so `galleryEnabled()` ran
 * once at BUILD time — when NODE_ENV is production and the flag is unset — and
 * `notFound()` was baked into the static page. The flag then did nothing at
 * runtime and the gallery was unreachable in every deployed environment,
 * including the ones meant to opt in.
 *
 * The general rule: a route whose visibility depends on a runtime value must
 * not be statically prerendered, or the value is frozen at build time.
 */
export const dynamic = 'force-dynamic';

export default async function GalleryPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  if (!galleryEnabled()) notFound();

  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = getMessages(locale);

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="gallery.title"
        descriptionKey="gallery.description"
        crumbs={[{ labelKey: 'nav.overview', href: `/${locale}` }, { labelKey: 'nav.gallery' }]}
      />
      <PageBody>
        <GalleryClient locale={locale} messages={messages} />
      </PageBody>
    </>
  );
}
