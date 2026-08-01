import { BrandMark } from '@/components/brand';
import { directionOf, isLocale, type Locale } from '@/i18n/config';
import { getMessages, translate } from '@/i18n/get-messages';

/**
 * Foundation proof page.
 *
 * This is NOT a dashboard and NOT a business screen. It exists to prove four
 * things render correctly before anything is built on them:
 *   1. Sass tokens are emitted and resolvable,
 *   2. Tailwind utilities resolve those same custom properties,
 *   3. the brand abstraction renders without any component knowing the identity,
 *   4. direction boots correctly per locale.
 * The dashboard shell, sidebar, data table and component gallery are the next
 * session's work.
 */
export default async function ProofPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const active: Locale = isLocale(locale) ? locale : 'ar';
  const messages = getMessages(active);

  const swatches = [
    'primary',
    'success',
    'warning',
    'error',
    'info',
    'surface-subtle',
    'border',
  ] as const;

  return (
    <main id="main" className="mx-auto max-w-content p-8">
      <header className="mb-8 flex items-center justify-between gap-4">
        <BrandMark />
        <span className="rounded-md bg-warning-subtle px-3 py-1 text-caption text-text-secondary">
          {translate(messages, 'app.provisionalBrand')}
        </span>
      </header>

      <h1 className="mb-2 text-page-title font-semibold text-text-primary">
        {translate(messages, 'proof.title')}
      </h1>
      <p className="mb-8 text-body text-text-secondary">
        {translate(messages, 'proof.tokensDescription')}
      </p>

      <section className="mb-8 rounded-lg border border-border bg-surface p-6 shadow-sm">
        <h2 className="mb-4 text-section-title font-medium text-text-primary">
          {translate(messages, 'proof.tokens')}
        </h2>
        <ul className="flex flex-wrap gap-3">
          {swatches.map((name) => (
            <li key={name} className="flex items-center gap-2 text-supporting text-text-secondary">
              <span
                className="inline-block h-6 w-6 rounded-md border border-border"
                style={{ backgroundColor: `var(--color-${name})` }}
              />
              {name}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        <dl className="grid gap-3 text-body">
          <div className="flex gap-2">
            <dt className="text-text-muted">{translate(messages, 'proof.brand')}:</dt>
            <dd className="text-text-primary">
              <BrandMark />
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-text-muted">{translate(messages, 'proof.direction')}:</dt>
            <dd className="text-text-primary">{directionOf(active)}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
