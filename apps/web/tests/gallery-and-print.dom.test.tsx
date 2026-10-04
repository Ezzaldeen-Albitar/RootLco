import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import postcss, { type AtRule } from 'postcss';
import * as sass from 'sass';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { FIXTURE_ROWS, simulateServer } from '@/components/gallery/fixtures';
import { MuiFoundationSection } from '@/components/gallery/MuiFoundationSection';
import { MuiWorkflowSection } from '@/components/gallery/MuiWorkflowSection';
import { MuiWrappersSection } from '@/components/gallery/MuiWrappersSection';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { PrintDocument, PrintTable } from '@/components/print/PrintDocument';
import { PrintToolbar } from '@/components/print/PrintToolbar';
import { galleryEnabled } from '@/lib/gallery-access';
import { BOTH_DIRECTIONS, renderLtr, renderRtl } from './render';

describe('gallery access', () => {
  it('is open in development and test', () => {
    expect(galleryEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(galleryEnabled({ NODE_ENV: 'test' })).toBe(true);
  });

  it('is CLOSED in production by default', () => {
    // The gallery is a map of the product's surface. There is no reason to hand
    // one out to an anonymous visitor.
    expect(galleryEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('can be opted back in for a staging review', () => {
    expect(galleryEnabled({ NODE_ENV: 'production', ROOTLCO_ENABLE_GALLERY: 'true' })).toBe(true);
  });

  it('treats any value other than the exact string "true" as off', () => {
    for (const value of ['1', 'yes', 'TRUE', '', 'false']) {
      expect(galleryEnabled({ NODE_ENV: 'production', ROOTLCO_ENABLE_GALLERY: value }), value).toBe(
        false
      );
    }
  });

  it('returns 404 rather than 403 when closed', () => {
    // A 403 confirms the route exists. Read from the route source, because the
    // distinction is the whole point and a refactor could silently reverse it.
    const source = readFileSync(
      // P1-26 moved the gallery into its own `(design)` route group: every
      // screen under `(dashboard)` now requires a session, and the gallery
      // deliberately does not — it renders fixtures only and its control is the
      // environment gate asserted above.
      join(__dirname, '..', 'src', 'app', '[locale]', '(design)', 'gallery', 'page.tsx'),
      'utf8'
    );
    expect(source).toContain('if (!galleryEnabled()) notFound();');
    expect(source).not.toMatch(/403|forbidden/i);
  });

  it('is the only route outside the authenticated group', () => {
    // The reason the gallery may sit outside `(dashboard)` is that it holds no
    // customer or business data. If a second screen ever appears in `(design)`,
    // that reasoning has to be re-made rather than inherited.
    const group = join(__dirname, '..', 'src', 'app', '[locale]', '(design)');
    expect(readdirSync(group).sort()).toEqual(['gallery', 'layout.tsx']);
  });
});

describe('gallery fixtures', () => {
  it('are deterministic', () => {
    const first = simulateServer(FIXTURE_ROWS, {
      page: 1,
      pageSize: 10,
      sort: null,
      filters: [],
      search: '',
    });
    const second = simulateServer(FIXTURE_ROWS, {
      page: 1,
      pageSize: 10,
      sort: null,
      filters: [],
      search: '',
    });
    expect(first).toEqual(second);
  });

  it('carry no personal data', () => {
    // A gallery is a screenshot magnet. Nothing on it may be a real name, phone
    // number, email, VIN or plate.
    const serialised = JSON.stringify(FIXTURE_ROWS);
    expect(serialised).not.toMatch(/@/);
    expect(serialised).not.toMatch(/\+?\d{9,}/);
    for (const row of FIXTURE_ROWS) {
      expect(row.reference).toMatch(/^DOC-\d{6}$/);
      expect(row.descriptionKey).toMatch(/^fixture\./);
    }
  });

  it('use canonical money strings, never numbers', () => {
    for (const row of FIXTURE_ROWS) {
      expect(typeof row.amount).toBe('string');
      expect(row.amount).toMatch(/^-?\d+\.\d{4}$/);
    }
  });
});

describe('print document', () => {
  it('renders header, body and footer slots', () => {
    renderLtr(
      <PrintDocument
        title="Sample"
        brand={<span>BRAND</span>}
        header={<p>Header</p>}
        footer={<p>Footer</p>}
      >
        <p>Body</p>
      </PrintDocument>
    );
    expect(screen.getByRole('heading', { name: 'Sample' })).toBeInTheDocument();
    expect(screen.getByText('BRAND')).toBeInTheDocument();
    expect(screen.getByText('Header')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });

  it('marks itself so the print stylesheet can find it', () => {
    const { container } = renderLtr(
      <PrintDocument title="Sample">
        <p>Body</p>
      </PrintDocument>
    );
    expect(container.querySelector('[data-print="document"]')).not.toBeNull();
  });

  it('forces the paper surface rather than the screen theme', () => {
    // A dark screen surface prints as a grey block and empties a toner
    // cartridge; `paper` is white regardless of theme.
    const { container } = renderLtr(
      <PrintDocument title="Sample">
        <p>Body</p>
      </PrintDocument>
    );
    expect(container.querySelector('[data-print="document"]')?.className).toContain('bg-paper');
  });

  it('uses real table markup, so a header repeats across printed pages', () => {
    renderLtr(
      <PrintTable
        headers={['A', 'B']}
        rows={[
          ['1', '2'],
          ['3', '4'],
        ]}
        caption="Lines"
      />
    );
    const table = screen.getByRole('table', { name: 'Lines' });
    // A grid of divs cannot repeat a header on page two.
    expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
    expect(table.querySelector('thead')).not.toBeNull();
    expect(table.querySelector('tbody')).not.toBeNull();
  });

  it('renders in Arabic RTL without its own layout', () => {
    renderRtl(
      <PrintDocument title="مستند">
        <p>محتوى</p>
      </PrintDocument>
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('heading', { name: 'مستند' })).toBeInTheDocument();
  });

  it('has no axe violations in either direction', async () => {
    for (const [, renderIn] of BOTH_DIRECTIONS) {
      const { container, unmount } = renderIn(
        <PrintDocument title="Sample" footer={<p>Footer</p>}>
          <PrintTable headers={['A']} rows={[['1']]} />
        </PrintDocument>
      );
      const results = await axe(container);
      expect(results.violations).toEqual([]);
      unmount();
    }
  });
});

describe('the print toolbar', () => {
  it('prints through the browser, offers the way back, and never reaches the paper', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const user = userEvent.setup();
    const { container } = renderLtr(
      <PrintToolbar printLabel="Print the sheet" backHref="/en/somewhere" backLabel="Back" />
    );
    await user.click(screen.getByRole('button', { name: 'Print the sheet' }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/en/somewhere');
    // Marked for the print sheet's `[data-print='hide']` rule.
    expect(container.querySelector('[data-print="hide"]')).toContainElement(
      screen.getByRole('button', { name: 'Print the sheet' })
    );
  });

  it('offers no way back when it is given none', () => {
    renderLtr(<PrintToolbar printLabel="Print the sheet" />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('the print stylesheet hides interactive chrome', () => {
  const source = readFileSync(
    join(__dirname, '..', 'src', 'styles', 'print', '_index.scss'),
    'utf8'
  );

  it('hides nav, buttons and anything marked for hiding', () => {
    expect(source).toContain("[data-print='hide']");
    expect(source).toContain('nav');
    expect(source).toContain("button:not([data-print='keep'])");
  });

  it('sets an A4 page with margins', () => {
    expect(source).toMatch(/@page/);
    expect(source).toMatch(/size:\s*a4/i);
    expect(source).toMatch(/margin:\s*\d+mm/);
  });

  it('avoids breaking a row across the fold', () => {
    expect(source).toMatch(/break-inside:\s*avoid/);
  });

  it('uses no raw colour, only the paper token', () => {
    expect(source).toContain('var(--color-paper)');
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

/**
 * Checkpoint browser QA, DEF-01: every printable document printed as ONE page —
 * the screenful at the current scroll position, the sheet cut after its title.
 * The print sheet's releases loaded and LOST: the sheet and the Tailwind
 * utilities are both unlayered (`styles/_layers.scss`), the utilities are
 * emitted after it (`app/globals.scss`), so a print selector must OUTRANK the
 * one utility class it overrides — and `main` (0,0,1), plain `body` and a bare
 * `[data-scroll-region]` (0,1,0, a tie lost on order) did not, while the shell
 * root was not selected at all.
 *
 * jsdom neither lays out nor applies `@media print`, so what is held here is the
 * cascade arithmetic itself, on the COMPILED stylesheet: each release is in
 * `@media print`, outside every layer, and more specific than what it beats.
 * The printed result — more than one page — is asserted in the browser tier
 * (`tests/e2e/foundation.spec.ts`, "prints the whole page").
 */
describe('the print sheet releases the application shell on paper', () => {
  interface Found {
    readonly selector: string;
    readonly order: number;
    readonly print: boolean;
    readonly layered: boolean;
    readonly declarations: Readonly<Record<string, string>>;
  }

  function compiledGlobals(): string {
    return sass.compile(join(__dirname, '..', 'src', 'app', 'globals.scss')).css;
  }

  /** Every selector of every rule, with where it sits in the cascade. */
  function rulesOf(css: string): Found[] {
    const found: Found[] = [];
    let order = 0;
    postcss.parse(css).walkRules((rule) => {
      order += 1;
      let print = false;
      let layered = false;
      for (let node = rule.parent; node && node.type !== 'root'; node = node.parent) {
        if (node.type === 'atrule' && (node as AtRule).name === 'media') {
          print ||= /\bprint\b/.test((node as AtRule).params);
        }
        if (node.type === 'atrule' && (node as AtRule).name === 'layer') layered = true;
      }
      const declarations: Record<string, string> = {};
      rule.walkDecls((decl) => {
        declarations[decl.prop] = decl.value;
      });
      for (const selector of rule.selectors) {
        found.push({ selector: selector.trim(), order, print, layered, declarations });
      }
    });
    return found;
  }

  /** (ids, classes/attributes/pseudo-classes, elements) of a simple selector. */
  function specificity(selector: string): readonly [number, number, number] {
    const ids = (selector.match(/#[\w-]+/g) ?? []).length;
    const classes =
      (selector.match(/\.[\w-]+/g) ?? []).length +
      (selector.match(/\[[^\]]+\]/g) ?? []).length +
      (selector.match(/:(?!:)[\w-]+/g) ?? []).length;
    const elements = (
      selector
        .replace(/\[[^\]]+\]/g, ' ')
        .replace(/[.#:][\w-]+/g, ' ')
        .match(/(^|[\s>+~])([a-z][\w-]*)/gi) ?? []
    ).length;
    return [ids, classes, elements];
  }

  function outranks(a: readonly number[], b: readonly number[]): number {
    for (let i = 0; i < 3; i += 1) {
      if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
    }
    return 0;
  }

  /** The utility class each release has to beat: one class, (0,1,0). */
  const ONE_UTILITY = [0, 1, 0] as const;

  /**
   * What must hold, as a list of broken rules — empty when the sheet is right.
   * Written as a function so the falsification below can run it on a sheet
   * that has fallen back to the selectors that lost.
   */
  function problems(css: string): string[] {
    const rules = rulesOf(css);
    const broken: string[] = [];
    const releases = (test: (selector: string) => boolean) =>
      rules.filter((rule) => rule.print && test(rule.selector));

    const lock = rules.find(
      (rule) => !rule.print && rule.selector === 'body.app-viewport' && !rule.layered
    );
    if (lock === undefined) broken.push('the screen lock body.app-viewport was not found');
    const body = releases((selector) => selector === 'body.app-viewport');
    if (
      !body.some(
        (rule) =>
          !rule.layered &&
          rule.declarations['overflow'] === 'visible' &&
          rule.declarations['height'] === 'auto' &&
          lock !== undefined &&
          rule.order > lock.order &&
          outranks(specificity(rule.selector), specificity(lock.selector)) >= 0
      )
    ) {
      broken.push('body.app-viewport is not released after, and at least as specific as, its lock');
    }

    const targets: {
      readonly name: string;
      readonly matches: (selector: string) => boolean;
      readonly needs: Readonly<Record<string, string>>;
    }[] = [
      {
        name: 'the shell boxes',
        matches: (selector) => /\[data-app-shell\]$/.test(selector),
        needs: { display: 'block', 'block-size': 'auto', overflow: 'visible' },
      },
      {
        name: 'the main region',
        matches: (selector) => /(^|\s)main$/.test(selector),
        needs: { 'block-size': 'auto', overflow: 'visible' },
      },
      {
        name: 'the scroll regions',
        matches: (selector) => /\[data-scroll-region\]$/.test(selector),
        needs: { 'max-block-size': 'none', overflow: 'visible' },
      },
    ];
    for (const target of targets) {
      const winning = releases(target.matches).filter(
        (rule) =>
          !rule.layered &&
          outranks(specificity(rule.selector), ONE_UTILITY) > 0 &&
          Object.entries(target.needs).every(([prop, value]) => rule.declarations[prop] === value)
      );
      if (winning.length === 0) {
        broken.push(`${target.name}: no print release outranks a utility class`);
      }
    }
    return broken;
  }

  const compiled = compiledGlobals();

  it('releases the body, the shell, main and every scroll region on paper, and wins', () => {
    expect(problems(compiled)).toEqual([]);
  });

  it('competes with the utilities because it is unlayered, and they are emitted after it', () => {
    const printAt = compiled.indexOf('[data-app-shell]');
    const utilitiesAt = compiled.indexOf('@tailwind utilities');
    expect(printAt).toBeGreaterThan(-1);
    expect(utilitiesAt).toBeGreaterThan(printAt);
  });

  it('leaves the working panels off the paper only where a screen opted in and a document is open', () => {
    const scoped = rulesOf(compiled).find(
      (rule) =>
        rule.print &&
        rule.selector.startsWith('[data-print-scope]:has([data-print=') &&
        rule.declarations['display'] === 'none'
    );
    expect(scoped).toBeDefined();
    expect(scoped?.layered).toBe(false);
  });

  /*
   * What the scoped rule HIDES, on the two shapes of page that opt in — worked
   * out by evaluating the compiled selector against a real DOM rather than by
   * reading its text. jsdom's selector engine refuses `:not(:has(…))`, so the
   * one grammar this rule uses — `scope > child`, each a compound of attribute
   * selectors, `:has(…)` and `:not(…)` — is evaluated here part by part, each
   * part through the DOM's own `matches` and `querySelector`.
   *
   * Checkpoint browser QA at 78602752 (RI3): the reception acknowledgement
   * printed BLANK. Its sheet is a DIRECT child of the scope, beside the
   * toolbar, and `:has()` only sees descendants, so the sheet matched
   * `:not(:has(document))` and hid itself.
   */
  const scopedSelector = (css: string): string => {
    const found = rulesOf(css).find(
      (rule) =>
        rule.print &&
        rule.selector.startsWith('[data-print-scope]:has(') &&
        rule.declarations['display'] === 'none'
    );
    if (found === undefined) throw new Error('the scoped print rule was not found');
    return found.selector;
  };

  /** Splits `a:has(b):not(c)` into its simple parts, keeping brackets whole. */
  function simpleParts(compound: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < compound.length; i += 1) {
      const ch = compound[i];
      if (ch === '(' || ch === '[') depth += 1;
      else if (ch === ')' || ch === ']') depth -= 1;
      if (
        depth === 0 &&
        i + 1 < compound.length &&
        (compound[i + 1] === ':' || compound[i + 1] === '[')
      ) {
        parts.push(compound.slice(start, i + 1));
        start = i + 1;
      }
    }
    parts.push(compound.slice(start));
    return parts.filter((part) => part.length > 0);
  }

  /** Splits `a, :has(b)` at its top-level commas. */
  function topLevelList(list: string): string[] {
    const members: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < list.length; i += 1) {
      const ch = list[i];
      if (ch === '(' || ch === '[') depth += 1;
      else if (ch === ')' || ch === ']') depth -= 1;
      else if (ch === ',' && depth === 0) {
        members.push(list.slice(start, i).trim());
        start = i + 1;
      }
    }
    members.push(list.slice(start).trim());
    return members.filter((member) => member.length > 0);
  }

  function matchesCompound(element: Element, compound: string): boolean {
    return simpleParts(compound.trim()).every((part) => {
      const has = /^:has\((.*)\)$/.exec(part);
      if (has) return element.querySelector(has[1] as string) !== null;
      // `:not(a, b)` — a selector list: matching any member excludes.
      const not = /^:not\((.*)\)$/.exec(part);
      if (not)
        return !topLevelList(not[1] as string).some((each) => matchesCompound(element, each));
      return element.matches(part);
    });
  }

  /** The elements under `root` the rule would hide. */
  function hiddenBy(selector: string, root: Element): Element[] {
    const [scopePart, childPart] = selector.split(/\s*>\s*/) as [string, string];
    const hidden: Element[] = [];
    for (const scope of [root, ...root.querySelectorAll('*')]) {
      if (!matchesCompound(scope, scopePart)) continue;
      for (const child of scope.children) {
        if (matchesCompound(child, childPart)) hidden.push(child);
      }
    }
    return hidden;
  }

  /** The acknowledgement: the toolbar and the sheet, siblings in the scope. */
  function acknowledgementPage(): HTMLElement {
    const page = document.createElement('div');
    page.innerHTML =
      '<div data-print-scope="document">' +
      '<div data-testid="toolbar"></div>' +
      '<article data-print="document" data-testid="sheet"></article>' +
      '</div>';
    return page;
  }

  /** The delivery screen: the sheet nested inside its panel, among other panels. */
  function deliveryPage(sheetOpen: boolean): HTMLElement {
    const page = document.createElement('div');
    page.innerHTML =
      '<div data-print-scope="document">' +
      '<section data-testid="release"></section>' +
      '<section data-testid="document-panel">' +
      (sheetOpen ? '<article data-print="document" data-testid="sheet"></article>' : '') +
      '</section>' +
      '</div>';
    return page;
  }

  const ids = (elements: readonly Element[]) =>
    elements.map((element) => element.getAttribute('data-testid'));

  it('prints the acknowledgement sheet that sits beside its toolbar, and leaves the toolbar off', () => {
    const hidden = hiddenBy(scopedSelector(compiled), acknowledgementPage());
    expect(ids(hidden)).toEqual(['toolbar']);
  });

  it('keeps the delivery sheet through its panel and leaves the other panels off', () => {
    expect(ids(hiddenBy(scopedSelector(compiled), deliveryPage(true)))).toEqual(['release']);
    // No document open: printing the screen prints the screen.
    expect(hiddenBy(scopedSelector(compiled), deliveryPage(false))).toEqual([]);
  });

  it('FALSIFICATION: the rule without its document guard hides the acknowledgement sheet', () => {
    const regressed = compiled.replace(
      />\s*:not\(\[data-print=['"]?document['"]?\],\s*:has\(/g,
      '> :not(:has('
    );
    expect(regressed).not.toBe(compiled);
    const hidden = ids(hiddenBy(scopedSelector(regressed), acknowledgementPage()));
    expect(hidden).toContain('sheet');
  });

  it('FALSIFICATION: the selectors that lost are refused', () => {
    // The sheet as it was when every printout came out as one page.
    const regressed = compiled
      .replace(/:root \[data-app-shell\],\s*:root main/g, 'main')
      .replace(/:root \[data-scroll-region\]/g, '[data-scroll-region]')
      .replace(/,\s*body\.app-viewport\s*\{/g, ' {');
    expect(regressed).not.toBe(compiled);
    const broken = problems(regressed).join('\n');
    expect(broken).toMatch(/body\.app-viewport is not released/);
    expect(broken).toMatch(/the shell boxes: no print release/);
    expect(broken).toMatch(/the main region: no print release/);
    expect(broken).toMatch(/the scroll regions: no print release/);
  });
});

/**
 * The gallery's Material UI section (ADR-022) — the visual reference the pull
 * requests that move screens onto Material UI copy from. Rendered inside the
 * foundation provider exactly as the locale layout mounts it.
 */
describe('the Material UI foundation section', () => {
  function renderSection(locale: Locale) {
    const messages = getMessages(locale);
    const renderIn = BOTH_DIRECTIONS.find(([candidate]) => candidate === locale)?.[1] ?? renderLtr;
    return renderIn(
      <UiFoundationProvider locale={locale} text={muiTextOf(messages)}>
        <MuiFoundationSection locale={locale} messages={messages} />
      </UiFoundationProvider>
    );
  }

  it('renders right to left in Arabic, with the Arabic component texts', () => {
    renderSection('ar');
    expect(document.documentElement.dir).toBe('rtl');
    const section = screen.getByTestId('mui-foundation');
    expect(within(section).getByRole('heading', { name: 'أساس Material UI' })).toBeInTheDocument();
    // Upstream ships no Arabic for these; they come from the catalogue.
    expect(within(section).getByText('عدد الصفوف في الصفحة')).toBeInTheDocument();
    expect(within(section).getByText('الصفحة 1')).toBeInTheDocument();
    expect(within(section).getByRole('tree', { name: 'الهيكل التنظيمي' })).toBeInTheDocument();
  });

  it('renders left to right in English, with the English component texts', () => {
    renderSection('en');
    expect(document.documentElement.dir).toBe('ltr');
    const section = screen.getByTestId('mui-foundation');
    expect(within(section).getByText('Rows per page')).toBeInTheDocument();
    expect(within(section).getByText('Page 1')).toBeInTheDocument();
  });

  it('shows the grid with no toolbar, no export, no print and no total', () => {
    for (const locale of ['en', 'ar'] as const) {
      const { unmount } = renderSection(locale);
      const grid = screen.getByRole('grid');
      expect(grid.querySelector('.MuiDataGrid-toolbarContainer, .MuiDataGrid-toolbar')).toBeNull();
      expect(
        screen.queryAllByRole('button', { name: /export|print|csv|تصدير|طباعة/i }),
        locale
      ).toEqual([]);
      // Five placeholder rows exist; no label may announce that number as a total.
      const footer = grid.querySelector('.MuiDataGrid-footerContainer');
      expect(footer?.textContent ?? '').not.toMatch(/of|من 5|total|المجموع/i);
      unmount();
    }
  });
});

/**
 * The shared wrappers (ADR-022 PR1) in the gallery: each one, in both
 * languages, driven by the gallery's placeholder rows through the real read
 * hooks, with no toolbar, export or total on the grid.
 */
describe('the shared Material UI wrappers section', () => {
  function renderWrappers(locale: Locale) {
    const messages = getMessages(locale);
    const renderIn = locale === 'ar' ? renderRtl : renderLtr;
    return renderIn(
      <UiFoundationProvider locale={locale} text={muiTextOf(messages)}>
        <MuiWrappersSection locale={locale} messages={messages} />
      </UiFoundationProvider>
    );
  }

  it.each(['en', 'ar'] as const)('renders every wrapper in %s', async (locale) => {
    const messages = getMessages(locale);
    renderWrappers(locale);
    expect(document.documentElement.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    const section = screen.getByTestId('mui-wrappers');
    expect(
      within(section).getByRole('heading', { name: messages['gallery.muiWrappers.title'] })
    ).toBeInTheDocument();

    const grid = within(section).getByRole('grid', {
      name: messages['gallery.muiWrappers.gridLabel'],
    });
    expect(await within(grid).findByRole('gridcell', { name: 'DOC-000101' })).toBeInTheDocument();
    expect(
      within(section).getByRole('link', {
        name: `${messages['gallery.muiWrappers.rowOpen']} DOC-000101`,
      })
    ).toBeInTheDocument();
    expect(within(section).getByTestId('gallery-operational-grid-page')).toHaveTextContent(
      messages['mui.pagination.page'].replace('{page}', '1')
    );
    expect(grid.querySelector('.MuiDataGrid-toolbarContainer, .MuiDataGrid-toolbar')).toBeNull();
    expect(section.textContent ?? '').not.toMatch(/\bof 5\b|من 5/);

    expect(
      within(section).getByRole('combobox', {
        name: new RegExp(`^${messages['gallery.muiWrappers.pickerLabel']}`),
      })
    ).toBeInTheDocument();
    expect(
      within(section).getByRole('textbox', {
        name: new RegExp(`^${messages['gallery.muiWrappers.fieldQuantity']}`),
      })
    ).toBeInTheDocument();
    expect(
      within(section).getByRole('textbox', { name: new RegExp(`^${messages['column.amount']}`) })
    ).toHaveValue('1250.0000');
    for (const testId of [
      'state-empty',
      'state-no-results',
      'state-loading',
      'state-unavailable',
      'state-error',
      'state-refused',
      'state-expired',
      'state-not-found',
      'state-stale',
    ]) {
      expect(within(section).getByTestId(testId), testId).toBeInTheDocument();
    }
  });
});

/**
 * The second set of shared wrappers (ADR-022 PR1) in the gallery: the branch
 * selector, the two decision dialogs, the filter toolbar, the date fields and
 * the figures, in both languages, over the gallery's placeholder rows.
 */
describe('the choosing, confirming, filtering and figures section', () => {
  function renderWorkflow(locale: Locale) {
    const messages = getMessages(locale);
    const renderIn = locale === 'ar' ? renderRtl : renderLtr;
    return renderIn(
      <UiFoundationProvider locale={locale} text={muiTextOf(messages)}>
        <MuiWorkflowSection locale={locale} messages={messages} />
      </UiFoundationProvider>
    );
  }

  it.each(['en', 'ar'] as const)('renders every wrapper in %s', async (locale) => {
    const messages = getMessages(locale);
    const user = userEvent.setup();
    renderWorkflow(locale);
    expect(document.documentElement.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    const section = screen.getByTestId('mui-workflow');
    expect(
      within(section).getByRole('heading', { name: messages['gallery.muiWorkflow.title'] })
    ).toBeInTheDocument();

    // One selector for several branches; a sentence for one.
    const selector = within(section).getByRole('combobox', {
      name: messages['workingContext.label'],
    });
    expect(
      within(selector).getByRole('option', { name: messages['workingContext.allBranches'] })
    ).toBeInTheDocument();
    expect(within(section).getByTestId('working-context-single')).toHaveTextContent(
      messages['gallery.muiWorkflow.branchFirst']
    );

    await user.click(
      within(section).getByRole('button', { name: messages['gallery.muiWorkflow.confirmOpen'] })
    );
    const confirm = await screen.findByRole('alertdialog', {
      name: messages['gallery.muiWorkflow.confirmTitle'],
    });
    await user.click(within(confirm).getByRole('button', { name: messages['overlay.cancel'] }));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    const toolbar = within(section).getByTestId('gallery-filter-toolbar');
    expect(
      within(toolbar).getByRole('searchbox', {
        name: messages['gallery.muiWorkflow.searchLabel'],
      })
    ).toBeInTheDocument();
    expect(
      within(toolbar).getByRole('button', { name: messages['filters.period.custom'] })
    ).toBeInTheDocument();

    expect(
      within(section).getByRole('group', {
        name: new RegExp(`^${messages['gallery.muiWorkflow.dateLabel']}`),
      })
    ).toBeInTheDocument();

    for (const [testId, state] of [
      ['gallery-metric-value', 'value'],
      ['gallery-metric-zero', 'zero'],
      ['gallery-metric-withheld', 'unauthorized'],
      ['gallery-metric-unavailable', 'unavailable'],
    ] as const) {
      expect(within(section).getByTestId(testId)).toHaveAttribute('data-metric-state', state);
    }
    expect(
      within(section).getByRole('img', { name: messages['gallery.muiWorkflow.chartTitle'] })
    ).toBeInTheDocument();
    expect(within(section).getByTestId('gallery-chart-states')).toHaveAttribute(
      'data-axis-reversed',
      String(locale === 'ar')
    );
    expect(section.textContent ?? '').not.toMatch(/[٠-٩۰-۹]/);
  });

  it('shows the period a board would send, on the fixed gallery clock', async () => {
    const user = userEvent.setup();
    const messages = getMessages('en');
    renderWorkflow('en');
    await user.click(screen.getByRole('button', { name: messages['filters.period.yesterday'] }));
    expect(screen.getByTestId('gallery-filter-sent')).toHaveTextContent(
      /A board would now ask for \d{4}-\d{2}-\d{2}T00:00:00\.000Z to \d{4}-\d{2}-\d{2}T23:59:59\.999999\+00:00\./
    );
  });
});
