import './print/react-jsx';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Locale } from '@/i18n/config';
import {
  counterSaleCase,
  invoiceCase,
  MESSAGES,
  printCases,
  SHELL_CHROME,
  type PrintCase,
} from './print/fixtures';
import { pdfPages, type PrintedPage } from './print/pdf-text';
import { applicationStylesheet } from './print/stylesheet';
import { fold, opening, printed, timesPrinted } from './print/text';

/**
 * The seven printable documents, printed to PDF by the browser and read page by
 * page.
 *
 * Checkpoint browser QA at 3cf622c3 printed an invoice that fits one page as
 * TWO — a blank first page carrying only its panel's border, the whole copy on
 * the second — and printed the page heading of the reception acknowledgement,
 * the handover sheet and the receipt above the document. Every DOM test was
 * green throughout: pagination happens only in a browser's print layout, so
 * this is where it is held.
 *
 * Each document is the real component inside a copy of the page that prints it
 * (`print/fixtures.tsx`), styled by the application's own compiled stylesheet,
 * printed with the A4 geometry `styles/print/_index.scss` declares. Per page it
 * asserts: the page begins with the document's identity row (title and
 * reference), so nothing is printed above the document and no page is without
 * it; there is something on the page besides that row; and no screen text —
 * page heading description, panel heading, toolbar, navigation — is printed at
 * all. The page count is held against the document's own measured height: a
 * document that fits the printable height prints on exactly one page.
 *
 * Each project prints in its own language: the Arabic projects print the Arabic
 * documents, right to left; the rest print the English ones.
 */

const MM = 96 / 25.4;
/** A4 inside the 16 mm `@page` margins, in CSS pixels. */
const PRINTABLE = { width: (210 - 32) * MM, height: (297 - 32) * MM };
/**
 * A document this tall or shorter must print on one page. A few pixels short of
 * the printable height, so sub-pixel rounding between the measurement and the
 * print layout cannot decide a case; between this and the full height only the
 * per-page assertions apply.
 */
const FITS_ONE_PAGE = PRINTABLE.height - 4;

function localeOf(testInfo: TestInfo): Locale {
  return testInfo.project.use.locale?.startsWith('ar') ? 'ar' : 'en';
}

let stylesheet = '';

test.beforeAll(async () => {
  stylesheet = await applicationStylesheet();
});

async function load(page: Page, printCase: PrintCase): Promise<void> {
  const dir = printCase.locale === 'ar' ? 'rtl' : 'ltr';
  await page.emulateMedia({ media: null });
  await page.setContent(
    `<!doctype html><html lang="${printCase.locale}" dir="${dir}"><head><meta charset="utf-8">` +
      `<style>${stylesheet}</style></head><body class="app-viewport">` +
      `${renderToStaticMarkup(printCase.page())}</body></html>`
  );
}

/** The document's height as print lays it out on the printable width. */
async function documentHeight(page: Page): Promise<number> {
  await page.setViewportSize({ width: Math.floor(PRINTABLE.width), height: 900 });
  await page.emulateMedia({ media: 'print' });
  const height = await page
    .locator('[data-print="document"]')
    .evaluate((element) => element.getBoundingClientRect().height);
  await page.emulateMedia({ media: null });
  return height;
}

/** The identity row as the document wrote it: the text repeated on every page. */
async function identityRow(page: Page): Promise<string> {
  const text = await page.getByTestId('print-document-identity').textContent();
  if (text === null || text.trim() === '') throw new Error('the document has no identity row');
  return text;
}

async function printToPages(page: Page): Promise<PrintedPage[]> {
  return pdfPages(await page.pdf({ format: 'A4', preferCSSPageSize: true }));
}

/**
 * Whether `text` BEGINS with `phrase`. Compared as the same characters in any
 * order over exactly the phrase's length, because a right-to-left row comes
 * back from the PDF in visual order with its number moved to one end.
 */
function beginsWith(text: string, phrase: string): boolean {
  const wanted = [...fold(phrase)];
  const head = [...fold(text)].slice(0, wanted.length);
  return head.sort().join('') === wanted.sort().join('');
}

/** `text` with the characters of `phrase` taken out once each, in any order. */
function withoutCharacters(text: string, phrase: string): string {
  const left = [...fold(text)];
  for (const character of fold(phrase)) {
    const at = left.indexOf(character);
    if (at >= 0) left.splice(at, 1);
  }
  return left.join('');
}

/** Whether two texts hold the same characters, in any order (see `beginsWith`). */
function sameCharacters(text: string, phrase: string): boolean {
  return [...fold(text)].sort().join('') === [...fold(phrase)].sort().join('');
}

function summary(pages: readonly PrintedPage[]): string {
  return pages
    .map((page, index) => `page ${index + 1}: ${page.runs.slice(0, 4).join(' | ')}`)
    .join('\n');
}

async function expectPrintedAsDocument(
  page: Page,
  printCase: PrintCase,
  testInfo: TestInfo
): Promise<PrintedPage[]> {
  await load(page, printCase);
  const height = await documentHeight(page);
  const identity = await identityRow(page);
  const pages = await printToPages(page);
  testInfo.annotations.push({
    type: `${printCase.document} (${printCase.locale})`,
    description: `${pages.length} page(s), document ${Math.round(height)}px of ${Math.round(PRINTABLE.height)}px\n${summary(pages)}`,
  });

  expect(printed(identity, printCase.title), `the identity row names the title`).toBe(true);
  expect(printed(identity, printCase.reference), `the identity row names the reference`).toBe(true);

  expect(pages.length, 'something was printed').toBeGreaterThan(0);
  if (height <= FITS_ONE_PAGE) {
    expect(
      pages.length,
      `the document is ${Math.round(height)}px tall and fits one ${Math.round(PRINTABLE.height)}px page\n${summary(pages)}`
    ).toBe(1);
  } else if (height > PRINTABLE.height) {
    expect(
      pages.length,
      `a ${Math.round(height)}px document needs more than one page`
    ).toBeGreaterThan(1);
  }
  // No page is spent on nothing: never more than one page per half page of content.
  expect(pages.length, summary(pages)).toBeLessThanOrEqual(
    Math.max(1, Math.ceil(height / (PRINTABLE.height / 2)))
  );

  pages.forEach((printedPage, index) => {
    expect(
      beginsWith(printedPage.text, identity),
      `page ${index + 1} begins with the identity row "${identity}"\n${summary(pages)}`
    ).toBe(true);
    expect(
      fold(printedPage.text).length,
      `page ${index + 1} carries more than the identity row\n${summary(pages)}`
    ).toBeGreaterThan(fold(identity).length);
  });

  const first = pages[0] as PrintedPage;
  expect(
    timesPrinted(first.text, printCase.title),
    'page 1 carries the document header after the identity row'
  ).toBeGreaterThanOrEqual(2);

  const everything = pages.map((printedPage) => printedPage.text).join(' ');
  for (const chrome of [...printCase.chrome, ...SHELL_CHROME]) {
    expect(printed(everything, opening(chrome)), `screen text "${chrome}" was printed`).toBe(false);
  }
  return pages;
}

test.describe('printed documents', () => {
  for (const name of [
    'invoice',
    'counter-sale',
    'receipt',
    'quotation',
    'credit-note',
    'delivery',
    'acknowledgement',
  ] as const) {
    test(`the ${name} prints as the document alone, its identity at the top of every page`, async ({
      page,
    }, testInfo) => {
      const printCase = printCases(localeOf(testInfo)).find((each) => each.document === name);
      if (printCase === undefined) throw new Error(`no fixture prints the ${name}`);
      await expectPrintedAsDocument(page, printCase, testInfo);
    });
  }

  test('an invoice that fills one page prints on that one page, starting at its top', async ({
    page,
  }, testInfo) => {
    /*
     * The case that printed a blank first page: a copy that fits a page, but
     * only just. The longest invoice that still fits the printable height is
     * found by measurement — in this browser, with these fonts — so the case
     * stays at the boundary wherever the suite runs.
     */
    const locale = localeOf(testInfo);
    let fitting: { readonly lines: number; readonly height: number } | null = null;
    for (let lines = 1; lines <= 40; lines += 1) {
      await load(page, invoiceCase(locale, lines));
      const height = await documentHeight(page);
      if (height > FITS_ONE_PAGE) break;
      fitting = { lines, height };
    }
    if (fitting === null) throw new Error('not even a one-line invoice fits a printed page');
    // At the boundary: one more line would not have fitted.
    expect(fitting.lines, 'the search stopped at the page boundary, not at its limit').toBeLessThan(
      40
    );
    testInfo.annotations.push({
      type: 'boundary',
      description: `${fitting.lines} line(s), ${Math.round(fitting.height)}px of ${Math.round(PRINTABLE.height)}px`,
    });

    const pages = await expectPrintedAsDocument(page, invoiceCase(locale, fitting.lines), testInfo);
    expect(pages.length).toBe(1);
  });

  /*
   * The local runtime QA printed a counter sale whose third page held only the
   * identity row and the closing sentence "Each line is described by the item that
   * was sold." Which length of sale does that depends on the browser's fonts, so
   * every length from one line to past two pages is printed, in four runs of eight
   * so each stays inside the suite's per-test time, and no page may hold the
   * identity row and that note and nothing else.
   */
  for (const [from, to] of [
    [1, 8],
    [9, 16],
    [17, 24],
    [25, 32],
  ] as const) {
    test(`a counter sale of ${from} to ${to} lines never prints its closing note alone on a page`, async ({
      page,
    }, testInfo) => {
      const locale = localeOf(testInfo);
      const note = (MESSAGES[locale] as unknown as Record<string, string>)[
        'invoices.print.descriptionsFromItems'
      ] as string;
      let longest = 0;
      for (let lines = from; lines <= to; lines += 1) {
        await load(page, counterSaleCase(locale, lines));
        const identity = await identityRow(page);
        const pages = await printToPages(page);
        longest = Math.max(longest, pages.length);
        pages.forEach((printedPage, index) => {
          expect(
            sameCharacters(withoutCharacters(printedPage.text, identity), note),
            `${lines} line(s): page ${index + 1} holds only the identity row and the closing note\n${summary(pages)}`
          ).toBe(false);
        });
      }
      // The longest run reaches a third page, where the defect was seen.
      if (to === 32) {
        expect(
          longest,
          'the longest sale printed spans at least three pages'
        ).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
