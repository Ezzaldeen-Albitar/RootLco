import type { ReactNode } from 'react';

/**
 * The printable-document frame.
 *
 * A shared layout for the invoice, receipt, reception document, delivery note
 * and report that later phases will build. It is deliberately NOT any of those:
 * it owns the page geometry, the repeating header and footer, and the rules
 * about what disappears on paper, so five documents cannot each invent them.
 *
 * ## What print actually gets wrong
 *
 * - **Interactive chrome on paper.** A printed invoice with a "Delete" button on
 *   it is a correctness failure. `data-print="hide"` and the print stylesheet
 *   remove them; anything that must survive carries `data-print="keep"`.
 * - **Dark surfaces.** The screen theme's surfaces would print as grey blocks
 *   and empty a toner cartridge. The document forces the `paper` token, which
 *   is white regardless of theme.
 * - **Table headers orphaned across pages.** `<thead>` inside a `<table>` with
 *   `display: table-header-group` repeats on every page. That is why long
 *   content here must be real table markup, not a grid of divs.
 * - **Pages two onwards that say nothing about which document they belong to.**
 *   The header prints once, on the first page. So a document that names a
 *   `reference` is the body of one outer table whose head row — the title and
 *   that reference — is drawn only on paper, and the browser repeats that head
 *   at the top of every printed page, the first included. On screen the row is
 *   not shown (`hidden`), so the reviewed copy is unchanged. A sheet that is
 *   not a document — the shelf labels, one label per page — names no reference
 *   and gets no such row.
 * - **Direction.** The document inherits `dir` from the document root, so an
 *   Arabic invoice is RTL without a second layout.
 *
 * No PDF is generated. This is HTML that prints well, and the phase does not
 * claim otherwise.
 */

export interface PrintDocumentProps {
  /** Configurable brand slot — the ONLY place branding enters a document. */
  readonly brand?: ReactNode;
  readonly header?: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  readonly title: string;
  /**
   * What identifies THIS document beside its title — its number, or the words
   * the document already uses for itself when it has no number — printed with
   * the title at the top of every page. Never invented. `null` repeats the
   * title alone (a document whose title already carries its number, or one
   * with no number to give); left out, nothing repeats.
   */
  readonly reference?: ReactNode | null;
}

export function PrintDocument({
  brand,
  header,
  footer,
  children,
  title,
  reference,
}: PrintDocumentProps) {
  const body = (
    <>
      <header className="mb-6 flex items-start justify-between gap-6 border-b border-border pb-4">
        <div className="min-w-0">
          {brand}
          <h1 className="mt-2 text-page-title font-semibold">{title}</h1>
        </div>
        {header ? (
          <div className="text-end text-supporting text-text-secondary">{header}</div>
        ) : null}
      </header>

      <div className="text-body leading-relaxed">{children}</div>

      {footer ? (
        <footer className="mt-8 border-t border-border pt-4 text-supporting text-text-muted">
          {footer}
        </footer>
      ) : null}
    </>
  );

  return (
    <article
      data-print="document"
      // `max-w-content` on screen approximates the printed measure so what an
      // operator reviews is close to what comes out of the printer.
      className="mx-auto w-full max-w-content rounded-lg border border-border bg-paper p-8 text-text-primary shadow-xs print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
    >
      {reference === undefined ? (
        body
      ) : (
        // A layout table, so `presentation`: it exists for the repeating head
        // row and says nothing to assistive technology.
        <table role="presentation" className="w-full border-collapse">
          {/*
            The document's identity on every printed page. Paper only: `hidden`
            keeps it off the screen, and in print it becomes the table head the
            browser repeats at the top of each page.
          */}
          <thead className="hidden print:table-header-group" data-testid="print-document-identity">
            <tr>
              <td className="border-b border-border pb-2 text-start text-supporting font-semibold">
                {/*
                  One run of text when the reference is text, so the repeated
                  number is a single phrase on paper and never a second copy
                  of the number the first page's header already names.
                */}
                {reference === null ? (
                  title
                ) : typeof reference === 'string' ? (
                  `${title} · ${reference}`
                ) : (
                  <>
                    {`${title} · `}
                    <bdi>{reference}</bdi>
                  </>
                )}
              </td>
            </tr>
          </thead>
          <tbody>
            {/* One row holds the whole document, so it must be allowed to break. */}
            <tr className="print:break-inside-auto">
              <td className="p-0 align-top">{body}</td>
            </tr>
          </tbody>
        </table>
      )}
    </article>
  );
}

/**
 * A table that survives a page break.
 *
 * Real `<thead>`/`<tbody>` markup, because that is what lets the browser repeat
 * the header on each printed page. `break-inside: avoid` on rows stops a single
 * row being split across the fold, which is the other half of a readable
 * multi-page table.
 */
export function PrintTable({
  headers,
  rows,
  caption,
}: {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly ReactNode[])[];
  readonly caption?: string;
}) {
  return (
    <table className="w-full border-collapse text-supporting">
      {caption ? (
        <caption className="pb-2 text-start text-text-secondary">{caption}</caption>
      ) : null}
      <thead>
        <tr>
          {headers.map((header) => (
            <th
              key={header}
              scope="col"
              className="border-b border-border-strong px-2 py-1.5 text-start font-semibold"
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} className="break-inside-avoid">
            {row.map((cell, cellIndex) => (
              <td key={cellIndex} className="border-b border-border px-2 py-1.5 align-top">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
