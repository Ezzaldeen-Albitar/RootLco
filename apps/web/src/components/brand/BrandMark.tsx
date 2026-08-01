import { brand, resolveBrandMark } from '@/config/brand';

/**
 * The ONLY component permitted to render the product identity.
 *
 * Every other component that needs to show the brand renders this. That is what
 * keeps the final logo swap to a configuration change: there is exactly one
 * consumer of `brand`, and `scripts/check-brand-isolation.mjs` fails the build
 * if another component reads it or references an asset path directly.
 */
export function BrandMark({ collapsed = false }: { readonly collapsed?: boolean }) {
  const mark = resolveBrandMark(brand);

  if (mark.kind === 'asset') {
    // eslint-disable-next-line @next/next/no-img-element -- the approved asset is
    // a static brand file; next/image adds no value and complicates print.
    return <img src={mark.src} alt={mark.alt} height={24} />;
  }

  return (
    <span
      className="inline-flex items-center gap-2 font-semibold text-text-primary"
      data-provisional={brand.isProvisional ? 'true' : undefined}
    >
      {collapsed ? mark.shortText : mark.text}
    </span>
  );
}
