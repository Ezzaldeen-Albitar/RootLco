import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

/**
 * Breadcrumbs and the page header.
 *
 * Server components: neither holds state, and rendering them on the client
 * would ship the whole navigation vocabulary to the browser for text that never
 * changes after paint.
 */

export interface Crumb {
  readonly labelKey: string;
  /**
   * Absolute href. The LAST crumb has none — it is the current page.
   *
   * Every crumb BEFORE the last should carry one: it names an ancestor the
   * operator expects to click. That cannot be said in the type without making
   * `crumbs` a tuple (`[...LinkedCrumb[], CurrentCrumb]`), which every
   * `const crumbs = [...]` call site in Administration would then fail to
   * satisfy, so `Breadcrumbs` decides the case at runtime instead and
   * `shell.dom.test.tsx` measures that no trail in this product produces one.
   */
  readonly href?: string;
}

export function Breadcrumbs({
  messages,
  crumbs,
}: {
  readonly messages: Messages;
  readonly crumbs: readonly Crumb[];
}) {
  if (crumbs.length === 0) return null;

  return (
    <nav aria-label={translate(messages, 'shell.breadcrumbs')}>
      <ol className="flex flex-wrap items-center gap-1 text-supporting text-text-muted">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          const label = translate(messages, crumb.labelKey as keyof Messages);
          return (
            <li key={crumb.labelKey} className="flex items-center gap-1">
              {index > 0 ? (
                // The separator is a logical `/` in the markup and is hidden
                // from assistive technology, which reads the list structure
                // instead. A CSS ::before separator would be announced by some
                // screen readers and copied into the clipboard by all of them.
                <span aria-hidden="true" className="text-text-disabled">
                  /
                </span>
              ) : null}
              {/*
                Three cases, because there are three — the original wrote
                `last || !crumb.href`, one branch answering two different
                questions, and "this crumb has no href" is not "this crumb is
                the current page". Three routes passed a parent with no href on
                their success branch, so index 0 and index 1 BOTH carried
                `aria-current="page"` inside one breadcrumb landmark, which
                tells a screen-reader user there are two current pages. It is
                the same conflation `currentPageKey` untangled for the sidebar
                one landmark over.
              */}
              {last ? (
                <span aria-current="page" className="text-text-secondary">
                  {label}
                </span>
              ) : crumb.href ? (
                <Link
                  href={crumb.href}
                  className="rounded-sm hover:text-text-primary hover:underline"
                >
                  {label}
                </Link>
              ) : (
                // An ancestor with no route of its own. Rendered as plain muted
                // text: not a link, because there is nowhere to go, and never
                // `aria-current`, because it is not the page. Marking it would
                // be the defect above; dropping it would silently shorten the
                // trail and leave the operator's position unstated.
                <span>{label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface PageHeaderProps {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly titleKey: string;
  readonly descriptionKey?: string;
  readonly crumbs?: readonly Crumb[];
  /** Primary and secondary actions for this page. */
  readonly actions?: ReactNode;
}

export function PageHeader({
  messages,
  titleKey,
  descriptionKey,
  crumbs = [],
  actions,
}: PageHeaderProps) {
  return (
    <div className="border-b border-border bg-surface px-6 py-5">
      <Breadcrumbs messages={messages} crumbs={crumbs} />
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {/*
            The page title is the h1. There is exactly one per page and the
            shell does not render another — the sidebar's group headings start
            at h3 under a visually hidden h2 for the same reason. A document
            with two h1s has no outline a screen-reader user can navigate.
          */}
          <h1 className="text-page-title font-semibold text-text-primary">
            {translate(messages, titleKey as keyof Messages)}
          </h1>
          {descriptionKey ? (
            <p className="mt-1 max-w-content text-body text-text-secondary">
              {translate(messages, descriptionKey as keyof Messages)}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/**
 * Standard page body padding, so every screen agrees without repeating itself.
 *
 * `fill` opts a screen into taking the scrollport's remaining height rather than
 * growing with its content. It is what lets a table shrink and scroll internally
 * so its pager stays on screen, instead of the pager being pushed below the fold
 * with the rows.
 *
 * It is opt-in rather than the default because most screens are prose, forms and
 * cards that SHOULD grow and let `main` scroll — forcing them into a fixed-height
 * box would give each of them its own inner scrollbar for no reason. Only the
 * four table screens ask for it.
 */
export function PageBody({
  children,
  fill = false,
}: {
  readonly children: ReactNode;
  readonly fill?: boolean;
}) {
  return (
    <div className={fill ? 'flex min-h-0 flex-1 flex-col px-6 py-6' : 'px-6 py-6'}>{children}</div>
  );
}
