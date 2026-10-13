'use client';

import Link from 'next/link';
import Button from '@mui/material/Button';

/**
 * The row of controls above a printable document — Print, and optionally the
 * way back — kept off the paper.
 *
 * A document page is a server component with no controls of its own; printing
 * is the browser's (`window.print()` opens its own dialogue and produces no
 * file). This is the one client piece such a page needs, and it is marked
 * `data-print="hide"`, so it never reaches the paper. Placed as a SIBLING of the
 * document inside a `data-print-scope` container (`styles/print/_index.scss`),
 * it is also left off by the scope rule, which prints the document alone.
 *
 * The back link is taken as an address and a label rather than as an element:
 * a server page cannot hand a client component a component reference.
 */
export function PrintToolbar({
  printLabel,
  backHref,
  backLabel,
  testId = 'print-toolbar',
}: {
  readonly printLabel: string;
  readonly backHref?: string | undefined;
  readonly backLabel?: string | undefined;
  readonly testId?: string;
}) {
  return (
    <div data-print="hide" data-testid={testId} className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="contained" onClick={() => window.print()}>
        {printLabel}
      </Button>
      {backHref !== undefined && backLabel !== undefined ? (
        <Button component={Link} href={backHref} variant="outlined">
          {backLabel}
        </Button>
      ) : null}
    </div>
  );
}
