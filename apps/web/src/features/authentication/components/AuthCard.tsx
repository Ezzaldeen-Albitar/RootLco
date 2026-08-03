import type { ReactNode } from 'react';

/**
 * The card every authentication screen sits in.
 *
 * One heading level, one description, one slot. It exists so five screens cannot
 * each invent their own spacing and their own heading size — and so the `<h1>`
 * is in exactly one place, which is what makes the heading order correct on
 * every one of them without anybody checking.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  readonly title: string;
  readonly description?: string | undefined;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border-subtle bg-surface p-8 shadow-sm">
      <h1 className="text-page-title font-semibold text-text-heading">{title}</h1>
      {description ? <p className="mt-2 text-body text-text-secondary">{description}</p> : null}
      <div className="mt-6">{children}</div>
      {footer ? <div className="mt-6 text-supporting text-text-secondary">{footer}</div> : null}
    </section>
  );
}
