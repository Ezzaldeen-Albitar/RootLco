import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { FIXTURE_ROWS, simulateServer } from '@/components/gallery/fixtures';
import { PrintDocument, PrintTable } from '@/components/print/PrintDocument';
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
