import { brand, resolveBrandMark, resolveBrandMarkSize, resolveCompanyMark } from '@/config/brand';

/**
 * The ONLY component permitted to render the product identity.
 *
 * Every other component that needs to show the brand renders this. That is what
 * keeps the final logo swap to a configuration change: there is exactly one
 * consumer of `brand`, and `scripts/check-brand-isolation.mjs` fails the build
 * if another component reads it or references an asset path directly.
 *
 * ## Why the symbol and the name are rendered together
 *
 * The approved product asset is an abstract monogram. It is a mark, not a name —
 * nobody can read a product out of it — so on its own it would leave the
 * application unnamed. Expanded, this renders the symbol beside the product
 * name; collapsed, the symbol alone, because the rail is 4rem wide and the name
 * has nowhere to go. The accessible name is carried by the image in both states,
 * so the collapsed rail is not a nameless icon to a screen reader.
 */
export function BrandMark({ collapsed = false }: { readonly collapsed?: boolean }) {
  const mark = resolveBrandMark(brand);
  const size = resolveBrandMarkSize(brand);

  if (mark.kind === 'asset') {
    // A fixed rendered height with the intrinsic ratio applied to the width.
    // Declaring both is what stops the header reflowing between the HTML
    // arriving and the bytes arriving.
    const height = 28;
    const width = size ? Math.round((size.width / size.height) * height) : undefined;

    return (
      <span className="inline-flex items-center gap-2 text-section-title font-semibold tracking-tight">
        {/*
          The approved asset is a static brand file: next/image adds no value here
          and complicates print. The directive must sit on the line IMMEDIATELY
          above the element — with a wrapped reason underneath it, "next line" was
          the comment, so the suppression covered nothing and the warning it named
          was live the whole time.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mark.src} alt={mark.alt} width={width} height={height} />
        {/*
          Hidden from assistive technology because the image alt already supplies
          the name. Rendering both would announce the product twice.
        */}
        {collapsed ? null : <span aria-hidden="true">{brand.systemName}</span>}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-2 text-section-title font-semibold tracking-tight"
      data-provisional={brand.isProvisional ? 'true' : undefined}
    >
      {collapsed ? mark.shortText : mark.text}
    </span>
  );
}

/**
 * The COMPANY attribution — deliberately not the product mark.
 *
 * ADR-011 and the `company-as-product` rule both say RootLco is the company and
 * must never be rendered as the product name. That rule matches a string, and an
 * image carries none, so putting a company wordmark in the product's slot would
 * break the rule in the one way the gate cannot see. This component exists so
 * the company mark has a slot of its own and cannot drift into the other one.
 *
 * Renders nothing when no company wordmark is configured. An absent attribution
 * is absent; it never degrades to text, because the product name is what must
 * always be legible and that is `BrandMark`'s job, not this one's.
 */
export function CompanyMark({ className }: { readonly className?: string }) {
  const company = resolveCompanyMark(brand);
  if (!company) return null;

  const height = 18;
  const width =
    company.width && company.height
      ? Math.round((company.width / company.height) * height)
      : undefined;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={company.src}
      alt={company.alt}
      width={width}
      height={height}
      // The asset is dark artwork on transparency, so it is legible on white and
      // invisible on navy. The caller supplies the surface-appropriate treatment
      // because the caller is the only thing that knows which surface it is on.
      className={className}
    />
  );
}
