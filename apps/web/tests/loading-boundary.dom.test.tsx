import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `P1-26-F-059` — the English interface announced its loading state in Arabic.
 *
 * The route group's `loading.tsx` is passed no props by Next, so it read
 * `DEFAULT_LOCALE`, which is `'ar'`. Every English navigation put the Arabic
 * string into the `aria-live` region a screen reader is given while the next
 * screen resolves.
 *
 * ## Why this test is here and not only in the browser
 *
 * The browser assertion written for `F-059` held the API response open to keep
 * the skeleton on screen long enough to read. It passed against a cold server
 * and failed against a warm one, because **the browser never requests the API
 * at all** — this application fetches on the server, so the delay it installed
 * matched nothing and the fallback appeared only when the server happened to be
 * slow. A test whose subject appears by luck is not a test; it is a flake that
 * agrees with you most of the time.
 *
 * Rendering the boundary directly removes the timing entirely: the component is
 * the thing that was wrong, and this is the component.
 */
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

let mockPathname = '/en/administration/users';

const { default: DashboardLoading } = await import('@/app/[locale]/(dashboard)/loading');

afterEach(() => {
  mockPathname = '/en/administration/users';
});

describe('the dashboard loading boundary speaks the route locale', () => {
  it('announces the English loading state on an English route', () => {
    mockPathname = '/en/administration/users';
    render(<DashboardLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.getByRole('status')).not.toHaveTextContent('جارٍ التحميل');
  });

  it('announces the Arabic loading state on an Arabic route', () => {
    mockPathname = '/ar/administration/users';
    render(<DashboardLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('جارٍ التحميل');
  });

  it('falls back to the default locale when the path carries none', () => {
    // Not a hypothetical: `usePathname` can return `/` during a transition, and
    // whatever it does then must be a decision rather than a crash.
    mockPathname = '/';
    render(<DashboardLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('جارٍ التحميل');
  });

  it('keeps the announcement polite and screen-reader only', () => {
    mockPathname = '/en';
    render(<DashboardLoading />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    // The visible part is the skeleton; the words exist for assistive
    // technology, which is exactly why no visual tier could ever see the bug.
    expect(status.querySelector('.sr-only')).not.toBeNull();
  });
});
