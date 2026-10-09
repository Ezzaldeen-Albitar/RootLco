'use client';

import type { ReactNode } from 'react';
import Paper from '@mui/material/Paper';

/**
 * The card every authentication screen sits in, on Material UI's `Paper`.
 *
 * One heading level, one description, one slot. It exists so five screens cannot
 * each invent their own spacing and their own heading size — and so the `<h1>`
 * is in exactly one place, which is what makes the heading order correct on
 * every one of them without anybody checking. The heading stays a literal `h1`
 * element here: `profile-accessibility.dom.test.tsx` reads the source for every
 * component that declares one. A client component because Material draws it; its
 * props are a title, a description and two slots, all of which a Server
 * Component page can pass.
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
    <Paper
      component="section"
      variant="outlined"
      data-testid="auth-card"
      className="rounded-2xl border border-border-subtle bg-surface p-8 shadow-sm"
    >
      <h1 className="text-page-title font-semibold text-text-heading">{title}</h1>
      {description ? <p className="mt-2 text-body text-text-secondary">{description}</p> : null}
      <div className="mt-6">{children}</div>
      {footer ? <div className="mt-6 text-supporting text-text-secondary">{footer}</div> : null}
    </Paper>
  );
}
