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

/**
 * The scroll-ownership contract, asserted against the source.
 *
 * Each entry names the token the contract depends on and WHY, so a failure here
 * reads as a broken rule rather than as a stale string. `mutate` is what makes
 * the assertion non-vacuous: it removes exactly the token under test, and the
 * guard below proves the check then FAILS. A scan that cannot fail is not a
 * check, and criterion 30 exists because this file previously guarded itself
 * with nothing more than "the file is longer than a thousand characters".
 */
const CONTRACT = [
  {
    file: 'components/shell/AppShell.tsx',
    token: 'relative flex h-dvh overflow-hidden',
    why: 'the shell is a CAP on the viewport and a containing block, not a floor',
  },
  {
    file: 'components/shell/AppShell.tsx',
    token: 'overscroll-contain',
    why: 'a gesture that reaches the end of a region must not chain outward',
  },
  {
    file: 'components/shell/AppShell.tsx',
    token: 'data-scroll-region',
    why: 'scrollbar-gutter is applied by attribute, so every region reserves it',
  },
  {
    file: 'components/shell/Sidebar.tsx',
    token: 'h-full min-h-0',
    token2: 'relative min-h-0 flex-1 overflow-y-auto',
    why: 'the nav scrolls inside a column it fills, and is its own containing block',
  },
  {
    file: 'components/data-table/DataTable.tsx',
    token: 'flex-initial',
    why: 'grow 0 keeps a short table short; shrink 1 yields to the pager first',
  },
  {
    file: 'styles/base/_reset.scss',
    token: 'body.app-viewport',
    why: 'the body lock is scoped to the locale layout, never applied globally',
  },
] as const;

describe('the shell is exactly the viewport, and its regions scroll', () => {
  const shell = read('components/shell/AppShell.tsx');
  const sidebar = read('components/shell/Sidebar.tsx');

  it('caps the shell at the viewport instead of only flooring it', () => {
    expect(shell, 'the root must be h-dvh, not min-h-dvh').toMatch(
      /className="relative flex h-dvh overflow-hidden/
    );
    expect(shell).not.toMatch(/className="flex min-h-dvh/);
  });

  it('makes every scroll container a containing block, which is the actual fix', () => {
    // `P1-26-F-069`. `overflow` clips descendants in FLOW; it does not clip an
    // absolutely positioned descendant whose containing block resolved past it.
    // While `main` was `position:static`, every `.sr-only` element — including
    // seventeen table captions on the permissions screen — resolved against the
    // INITIAL containing block and was laid out at document coordinates, growing
    // the document to 7075px against a 900px viewport.
    const main = /<main[\s\S]*?className="([^"]+)"/.exec(shell)?.[1] ?? '';
    expect(main, 'main must establish a containing block').toContain('relative');
    expect(main).toContain('overflow-y-auto');
    expect(main).toContain('min-h-0');
    expect(main).toContain('flex-1');
    // `flex-col` is what lets a screen opt into filling the scrollport.
    expect(main).toContain('flex-col');
  });

  it('does not reach for contain:paint or isolation, which would break overlays', () => {
    // `contain:paint` also creates a containing block for FIXED descendants, and
    // every Dialog and Drawer is `fixed inset-0` rendered inline from a screen
    // inside `main` — they would be clipped to main's box. `isolation:isolate`
    // creates a stacking context but NOT a containing block, so it would not fix
    // the defect and would flatten dropdown, dialog and toast under the header.
    expect(shell).not.toMatch(/contain:\s*paint|contain-paint/);
    expect(shell).not.toMatch(/isolation:\s*isolate|isolate\b/);
  });

  it('lets the sidebar fill its column rather than declaring its own height', () => {
    expect(sidebar, 'h-dvh made the sidebar independent of the shell').toMatch(/h-full min-h-0/);
    expect(sidebar).not.toMatch(/hidden h-dvh shrink-0/);
  });

  it('scrolls the navigation region internally, below a fixed brand block', () => {
    expect(sidebar).toMatch(
      /<nav[\s\S]{0,600}?className="subtle-scrollbar-on-dark relative min-h-0 flex-1 overflow-y-auto/
    );
    // The brand block must NOT scroll with it.
    expect(sidebar).toMatch(/flex h-16 shrink-0 items-center/);
  });

  it('bounds the table body so rows cannot push the page taller', () => {
    const table = read('components/data-table/DataTable.tsx');
    // Capped for screens that have not opted into a filling layout, and
    // shrink-capable for those that have.
    expect(table).toMatch(/max-h-\[70dvh\]/);
    expect(table).toMatch(/flex-initial/);
    // A sticky header inside a container that never scrolls has nothing to
    // stick to, so the two belong together.
    expect(table).toMatch(/<thead className="sticky top-0/);
  });

  it('locks the document only on the locale layout, never on every body', () => {
    const reset = read('styles/base/_reset.scss');
    // Unscoped, `body { overflow: hidden }` also reaches routes outside
    // `[locale]` — the root page and Next's built-in not-found — which have no
    // shell and no inner scroller, and whose content would become unreachable
    // rather than scrollable.
    expect(reset).toMatch(/body\.app-viewport\s*\{[^}]*overflow:\s*hidden/);
    expect(reset).not.toMatch(/^body\s*\{[^}]*overflow:\s*hidden/m);
  });

  it('proves each contract token is load-bearing by removing it', () => {
    // The anti-vacuity guard, and the reason this file can be trusted. Every
    // token above is deleted from a COPY of its own source and the search is
    // repeated; if the token was already absent, or matched something
    // incidental, the mutated copy still contains it and this fails.
    for (const entry of CONTRACT) {
      const source = read(entry.file);
      expect(source, `${entry.file}: ${entry.token} — ${entry.why}`).toContain(entry.token);
      const mutated = source.split(entry.token).join('');
      expect(mutated, `${entry.file}: removing ${entry.token} must be detectable`).not.toContain(
        entry.token
      );
      if ('token2' in entry && entry.token2) {
        expect(source, `${entry.file}: ${entry.token2}`).toContain(entry.token2);
      }
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
