import { BrandMark, CompanyMark } from './BrandMark';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

/**
 * The sign-in visual panel.
 *
 * It replaces a flat navy rectangle that held a logo, one sentence and a
 * company mark — three items in a column with the rest of a 1200px-wide surface
 * left empty. The first screen of a commercial product should say what the
 * product is for.
 *
 * ## What it is allowed to be
 *
 * Entirely decorative and `aria-hidden`. It carries no control, no instruction
 * and nothing a user must read to sign in, which is exactly what makes it safe
 * to drop below `lg` — the test for whether a decorative panel is really
 * decorative is whether a narrow viewport loses anything by removing it.
 *
 * Everything here is either a semantic token or a shape drawn from them. There
 * is no raw colour literal: `src/styles/tokens/_colors.scss` is the only file
 * in the frontend permitted to hold one, and the design-token gate fails the
 * build on a second. The green is the action colour and appears sparingly; navy
 * is the grounding surface, as it is on the sidebar, so the first screen and the
 * application behind it read as one product.
 *
 * ## Text
 *
 * Every string is a catalogue key. A literal here would ship an English-only
 * marketing panel to an Arabic operator, which is the one thing this panel
 * could get badly wrong.
 */
export function AuthShowcase({ messages }: { readonly messages: Messages }) {
  const points = ['auth.showcase.point1', 'auth.showcase.point2', 'auth.showcase.point3'] as const;

  return (
    <aside
      // Decorative: it holds identity and marketing, nothing operable. Hidden
      // from assistive technology rather than announced as a second, contentless
      // heading before the form the user actually came for.
      aria-hidden="true"
      className="relative hidden flex-col justify-between overflow-hidden bg-sidebar-background p-12 text-sidebar-text lg:flex"
    >
      {/*
        Depth, drawn rather than imported. A photograph would date, would need a
        licence, and would have to be shipped and cached for a screen the user
        sees for four seconds. Two soft radial washes and a hairline grid cost
        nothing and stay on-brand because they are built from brand tokens.
      */}
      {/*
        `--color-primary-active` and `--color-primary`, both of which exist.
        The first draft reached for `--color-primary-strong`, which does not —
        an undefined custom property resolves to nothing, the gradient silently
        produced no colour stop, and the panel rendered flat. It looked like a
        design choice rather than a typo, which is what makes this class of
        mistake worth a comment: CSS does not report an unknown variable.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40 [background:radial-gradient(55rem_38rem_at_12%_-8%,var(--color-primary-active),transparent_62%),radial-gradient(45rem_32rem_at_108%_106%,var(--color-primary),transparent_58%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,var(--color-sidebar-text)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-sidebar-text)_1px,transparent_1px)] [background-size:3rem_3rem]"
      />

      <div className="relative text-sidebar-text">
        <BrandMark onDark />
      </div>

      <div className="relative flex max-w-md flex-col gap-8">
        <p className="text-display text-sidebar-text">
          {translate(messages, 'auth.showcase.headline')}
        </p>
        <p className="text-body-large text-sidebar-text-muted">
          {translate(messages, 'auth.shellTagline')}
        </p>

        <ul className="flex flex-col gap-4">
          {points.map((key) => (
            <li key={key} className="flex items-start gap-3">
              {/*
                A mark, not an icon font and not an emoji: a shape built from a
                token renders identically in both directions and needs no
                additional asset.
              */}
              <span
                aria-hidden="true"
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sidebar-active"
              />
              <span className="text-body text-sidebar-text-muted">{translate(messages, key)}</span>
            </li>
          ))}
        </ul>

        {/*
          A restrained proof-of-life panel rather than a fabricated dashboard
          screenshot. It shows the SHAPE of the product — grouped surfaces, a
          status line — without inventing numbers that would be a lie about a
          system the viewer has not signed in to yet.
        */}
        <div className="rounded-xl border border-sidebar-border bg-sidebar-surface/70 p-4 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-sidebar-active" />
            <span className="text-caption uppercase tracking-wide text-sidebar-text-muted">
              {translate(messages, 'auth.showcase.secureLabel')}
            </span>
          </div>
          <p className="mt-2 text-supporting text-sidebar-text-muted">
            {translate(messages, 'auth.showcase.secureBody')}
          </p>
        </div>
      </div>

      <div className="relative flex items-center gap-3 text-sidebar-text-muted">
        <span className="text-supporting">{translate(messages, 'brand.byCompany')}</span>
        {/*
          The artwork is dark on transparency, so on this navy surface it is
          inverted to white — `brightness-0` flattens it to black first so the
          invert lands on pure white whatever the source colour was.
        */}
        <CompanyMark className="opacity-80 brightness-0 invert" />
      </div>
    </aside>
  );
}
