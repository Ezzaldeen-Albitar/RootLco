import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthShowcase } from '@/components/brand/AuthShowcase';
import { getMessages } from '@/i18n/get-messages';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';

/**
 * `P1-26-F-064` — the page scrolled, so the sidebar scrolled away with it.
 *
 * The shell root was `min-h-dvh`: a floor, not a cap. The document grew with
 * the content, and because the desktop sidebar is a statically positioned
 * `h-dvh` box rather than a sticky one, it travelled up and off the screen. Its
 * `overflow-y-auto` never engaged — the nav was not what was overflowing, the
 * document was.
 *
 * Measured on `/en/administration/users` at a 900px viewport, before and after:
 *
 *              documentScrollHeight   pageScrolls   main overflow-y
 *   before             991               true          visible
 *   after              900               false         auto
 *
 * These assertions are on the SOURCE because the rule is a layout contract
 * between four elements, and jsdom computes no layout — it would report every
 * height as zero and agree with anything. The live measurement lives in
 * `.local/probe-shell-layout.mjs` and in the browser tier.
 */

const SRC = join(__dirname, '..', 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('the shell is exactly the viewport, and its regions scroll', () => {
  const shell = read('components/shell/AppShell.tsx');
  const sidebar = read('components/shell/Sidebar.tsx');

  it('caps the shell at the viewport instead of only flooring it', () => {
    expect(shell, 'the root must be h-dvh, not min-h-dvh').toMatch(
      /className="flex h-dvh overflow-hidden/
    );
    expect(shell).not.toMatch(/className="flex min-h-dvh/);
  });

  it('gives the main region its own scroll, with min-h-0 so it can shrink', () => {
    // Without `min-h-0` a flex child refuses to shrink below its content, so
    // `overflow-y-auto` has nothing to overflow and the box grows instead.
    const main = /<main[\s\S]*?className="([^"]+)"/.exec(shell)?.[1] ?? '';
    expect(main).toContain('overflow-y-auto');
    expect(main).toContain('min-h-0');
    expect(main).toContain('flex-1');
  });

  it('lets the sidebar fill its column rather than declaring its own height', () => {
    expect(sidebar, 'h-dvh made the sidebar independent of the shell').toMatch(/h-full min-h-0/);
    expect(sidebar).not.toMatch(/hidden h-dvh shrink-0/);
  });

  it('scrolls the navigation region internally, below a fixed brand block', () => {
    expect(sidebar).toMatch(/<nav[^>]*className="min-h-0 flex-1 overflow-y-auto/);
    // The brand block must NOT scroll with it.
    expect(sidebar).toMatch(/flex h-16 shrink-0 items-center/);
  });

  it('bounds the table body so rows cannot push the page taller', () => {
    const table = read('components/data-table/DataTable.tsx');
    expect(table).toMatch(/max-h-\[70dvh\] overflow-auto/);
    // A sticky header inside a container that never scrolls has nothing to
    // stick to, so the two belong together.
    expect(table).toMatch(/<thead className="sticky top-0/);
  });

  it('scans real files, so the assertions above are not vacuous', () => {
    for (const [name, source] of [
      ['AppShell', shell],
      ['Sidebar', sidebar],
    ] as const) {
      expect(source.length, name).toBeGreaterThan(1_000);
    }
  });
});

describe('the sign-in showcase panel', () => {
  it('renders the brand, the headline and every selling point', () => {
    render(<AuthShowcase messages={getMessages('en')} />);
    expect(screen.getByText(en['auth.showcase.headline'])).toBeInTheDocument();
    for (const key of [
      'auth.showcase.point1',
      'auth.showcase.point2',
      'auth.showcase.point3',
    ] as const) {
      expect(screen.getByText(en[key])).toBeInTheDocument();
    }
    expect(screen.getByText(en['auth.showcase.secureLabel'])).toBeInTheDocument();
  });

  it('renders the Arabic catalogue on the Arabic locale', () => {
    render(<AuthShowcase messages={getMessages('ar')} />);
    expect(screen.getByText(ar['auth.showcase.headline'])).toBeInTheDocument();
    // The point of the catalogue: no English leaks into the Arabic panel.
    expect(screen.queryByText(en['auth.showcase.headline'])).toBeNull();
  });

  it('stays decorative — hidden from assistive technology, no controls', () => {
    // It sits before the form in the DOM. Announced, it would be a wall of
    // marketing a screen-reader user must pass to reach the field they came for.
    const { container } = render(<AuthShowcase messages={getMessages('en')} />);
    const panel = container.querySelector('aside');
    expect(panel?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('a, button, input')).toHaveLength(0);
  });

  it('collapses below the large breakpoint rather than pushing the form down', () => {
    const { container } = render(<AuthShowcase messages={getMessages('en')} />);
    const panel = container.querySelector('aside');
    expect(panel?.className).toContain('hidden');
    expect(panel?.className).toContain('lg:flex');
  });

  it('states every string through the catalogue, never as a literal', () => {
    const source = readFileSync(join(SRC, 'components/brand/AuthShowcase.tsx'), 'utf8');
    const body = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');
    // Every rendered string goes through `translate`; a bare sentence in JSX
    // would ship an English-only panel to an Arabic operator.
    expect(body).not.toMatch(/>\s*[A-Z][a-z]+ [a-z]+[^<{]*</);
    expect(body).toMatch(/translate\(messages,/);
  });
});
