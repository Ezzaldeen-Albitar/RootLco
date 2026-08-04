import { expect, test } from '@playwright/test';

/**
 * The shared-UX acceptance contract, measured in a real browser.
 *
 * Every assertion here is geometric or navigational, and none of them can live
 * in the component tier: jsdom has no layout engine, so `scrollHeight`,
 * `clientHeight` and `getBoundingClientRect()` are all zero there and would
 * agree with any implementation. A "the document does not scroll" test that
 * passes in jsdom proves nothing at all, which is why these are here.
 *
 * The baseline these replace was measured before the fix, in this same browser:
 *
 *   route                              document/viewport   overscroll
 *   /en/administration/permissions          7075 / 900        6175
 *   /ar/administration/users (420px)         428 / 420           8
 *
 * The cause was `.sr-only` — `position:absolute` — resolving its containing
 * block to the viewport because `main` was `position:static`, so seventeen 1px
 * table captions were laid out at document coordinates (`P1-26-F-069`).
 */

const ADMIN = '/en/administration/users';
const TOLERANCE = 2;

/** Every viewport the acceptance criteria name, including two short ones. */
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 700 },
  { name: 'tablet', width: 1024, height: 560 },
  { name: 'short', width: 1280, height: 420 },
] as const;

test.describe('scroll ownership', () => {
  for (const viewport of VIEWPORTS) {
    for (const route of [ADMIN, '/en/administration/permissions', '/ar/administration/users']) {
      test(`the document does not scroll at ${viewport.name} on ${route}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(route);
        await expect(page.getByRole('navigation', { name: /Modules|الوحدات/ })).toBeVisible();

        const geometry = await page.evaluate(() => {
          const de = document.documentElement;
          // Ask the document to scroll as far as it can. A reported
          // `scrollHeight` can exceed `clientHeight` without the document being
          // scrollable; what the user experiences is whether it MOVES.
          const before = de.scrollTop;
          de.scrollTop = 99_999;
          const reached = de.scrollTop;
          de.scrollTop = before;
          return {
            scrollHeight: de.scrollHeight,
            clientHeight: de.clientHeight,
            reached,
          };
        });

        expect(
          geometry.reached,
          'the document must not move — a blank region below the content is exactly this'
        ).toBeLessThanOrEqual(TOLERANCE);
        expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight + TOLERANCE);
      });
    }
  }

  test('the main region scrolls internally instead', async ({ page }) => {
    // 420px is short enough that the permissions screen cannot possibly fit.
    // A taller viewport would let the assertion pass because there was nothing
    // to scroll, which proves the opposite of what it claims.
    await page.setViewportSize({ width: 1280, height: 420 });
    await page.goto('/en/administration/permissions');
    // Waiting for the SIDEBAR is not waiting for the page: the shell renders
    // immediately and the permission tables arrive from the API afterwards, so
    // measuring on the landmark measures an empty screen that legitimately does
    // not overflow. Wait for the content that creates the overflow.
    await expect(page.getByRole('table').first()).toBeVisible();

    const main = await page.evaluate(() => {
      const el = document.querySelector('main#main');
      if (!el) return null;
      el.scrollTop = 99_999;
      return {
        reached: el.scrollTop,
        overflowY: getComputedStyle(el).overflowY,
        scrolls: el.scrollHeight > el.clientHeight + 1,
        documentMoved: document.documentElement.scrollTop,
      };
    });

    expect(main?.overflowY).toBe('auto');
    expect(main?.scrolls, 'this route has more content than a 420px viewport').toBe(true);
    expect(main?.reached, 'and it is main that moves').toBeGreaterThan(0);
    expect(main?.documentMoved, 'while the document stays still').toBeLessThanOrEqual(TOLERANCE);
  });

  test('the sidebar navigation scrolls internally and its last item is reachable', async ({
    page,
  }) => {
    // 560px is short enough that the navigation cannot fit, which is the whole
    // point: at 900px it fits and the assertion would pass without proving it.
    await page.setViewportSize({ width: 1024, height: 560 });
    await page.goto(ADMIN);
    const nav = page.getByRole('navigation', { name: 'Modules' });
    await expect(nav).toBeVisible();

    const measured = await page.evaluate(() => {
      const el = document.querySelector('aside nav');
      if (!el) return null;
      const links = el.querySelectorAll('a');
      const last = links[links.length - 1];
      last?.scrollIntoView({ block: 'nearest' });
      const rect = last?.getBoundingClientRect();
      const navRect = el.getBoundingClientRect();
      return {
        scrolls: el.scrollHeight > el.clientHeight + 1,
        overflowY: getComputedStyle(el).overflowY,
        lastVisible: rect
          ? rect.top >= navRect.top - 2 && rect.bottom <= navRect.bottom + 2
          : false,
        documentMoved: document.documentElement.scrollTop,
      };
    });

    expect(measured?.overflowY).toBe('auto');
    expect(measured?.scrolls, 'the navigation must be the thing that overflows').toBe(true);
    expect(measured?.lastVisible, 'the last item must be reachable by scrolling the nav').toBe(
      true
    );
    expect(
      measured?.documentMoved,
      'and reaching it must not scroll the document'
    ).toBeLessThanOrEqual(TOLERANCE);
  });

  test('the brand block stays put while the navigation scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 560 });
    await page.goto(ADMIN);
    await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();

    const before = await page.evaluate(
      () => document.querySelector('aside > div')?.getBoundingClientRect().top ?? null
    );
    await page.evaluate(() => {
      const nav = document.querySelector('aside nav');
      if (nav) nav.scrollTop = 99_999;
    });
    const after = await page.evaluate(
      () => document.querySelector('aside > div')?.getBoundingClientRect().top ?? null
    );

    expect(before).not.toBeNull();
    expect(after, 'the brand must not travel with the navigation').toBe(before);
  });

  test('the table stays inside its region and the pager stays reachable', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(ADMIN);
    await expect(page.getByRole('table')).toBeVisible();

    const measured = await page.evaluate(() => {
      const table = document.querySelector('table');
      const box = table?.closest('div');
      const de = document.documentElement;
      return {
        boxOverflow: box ? getComputedStyle(box).overflowY : null,
        boxWithinViewport: box ? box.getBoundingClientRect().height <= de.clientHeight : false,
        documentScrolls: de.scrollHeight > de.clientHeight + 2,
      };
    });

    expect(measured.boxOverflow).toBe('auto');
    expect(measured.boxWithinViewport, 'the table region must fit the viewport').toBe(true);
    expect(measured.documentScrolls).toBe(false);
  });
});

test.describe('the global notification authority', () => {
  test('is mounted exactly once, on every route, before any message exists', async ({ page }) => {
    for (const route of [ADMIN, '/en', '/ar/administration/users']) {
      await page.goto(route);
      const region = page.getByTestId('notification-region');
      await expect(region, `one region on ${route}`).toHaveCount(1);
      // Scoped INSIDE the region. The application has other polite live regions
      // by design — the table announces its result range, and the loading state
      // is a `role="status"` — so a document-wide count would be asserting
      // something else entirely and would fail for a correct reason.
      await expect(region.locator('[aria-live="polite"]')).toHaveCount(1);
      await expect(region.locator('[aria-live="assertive"]')).toHaveCount(1);
    }
  });

  test('is fixed to the viewport, at the inline-end corner, in both directions', async ({
    page,
  }) => {
    for (const [route, expected] of [
      ['/en/administration/users', 'right'],
      ['/ar/administration/users', 'left'],
    ] as const) {
      await page.goto(route);
      const box = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="notification-region"]');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          position: getComputedStyle(el).position,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          viewportWidth: document.documentElement.clientWidth,
        };
      });
      expect(box?.position, `${route} must be viewport-fixed`).toBe('fixed');
      expect(box?.top, `${route} must be pinned near the top`).toBeLessThan(64);
      if (expected === 'right') {
        expect(box!.right).toBeGreaterThan(box!.viewportWidth / 2);
      } else {
        expect(box!.left).toBeLessThan(box!.viewportWidth / 2);
      }
    }
  });

  test('stays visible with the main region scrolled to the bottom, and adds no height', async ({
    page,
  }) => {
    // The gallery raises a real notification through the real authority, which
    // is why it no longer keeps a stack of its own. `/en` explicitly: this case
    // runs under both locale projects and the control's name is translated.
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto('/en/gallery');

    const heightBefore = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.getByRole('button', { name: 'Show a notification' }).click();
    const toast = page.getByTestId('notification').first();
    await expect(toast).toBeVisible();

    await page.evaluate(() => {
      const main = document.querySelector('main#main');
      if (main) main.scrollTop = 99_999;
    });

    const after = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="notification"]');
      const rect = el?.getBoundingClientRect();
      const de = document.documentElement;
      return {
        top: rect?.top ?? -1,
        bottom: rect?.bottom ?? -1,
        viewportHeight: de.clientHeight,
        scrollHeight: de.scrollHeight,
      };
    });

    expect(
      after.top,
      'still inside the viewport after scrolling to the bottom'
    ).toBeGreaterThanOrEqual(0);
    expect(after.bottom).toBeLessThanOrEqual(after.viewportHeight);
    expect(after.scrollHeight, 'a fixed toast must not add document height').toBeLessThanOrEqual(
      heightBefore + TOLERANCE
    );
  });
});

test.describe('runtime language switching', () => {
  test('switches en to ar and back, preserving the route and the session', async ({ page }) => {
    await page.goto(ADMIN);
    await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();

    await page.getByRole('link', { name: 'العربية' }).click();
    await page.waitForURL(/\/ar\/administration\/users/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // Still signed in: the shell only renders for a resolved session.
    await expect(page.getByRole('navigation', { name: 'الوحدات' })).toBeVisible();

    await page.getByRole('link', { name: 'English' }).click();
    await page.waitForURL(/\/en\/administration\/users/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();
  });

  test('carries safe table state and drops everything else', async ({ page }) => {
    await page.goto(`${ADMIN}?page=2&pageSize=50&sort=email:asc&token=SECRET&q=Ali`);
    await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();

    const href = await page.getByRole('link', { name: 'العربية' }).getAttribute('href');
    expect(href).toContain('/ar/administration/users');
    expect(href).toContain('page=2');
    expect(href).toContain('pageSize=50');
    expect(href).toContain('sort=email');
    // The two that must never travel: a token, and free text an operator typed.
    expect(href, 'a token must never survive a language change').not.toContain('SECRET');
    expect(href, 'operator-typed text is not safe to publish').not.toContain('Ali');
  });

  test('is reachable while the sidebar is collapsed', async ({ page }) => {
    await page.goto(ADMIN);
    await page.getByRole('button', { name: /collapse navigation/i }).click();
    // The control lives in the header, so collapsing the sidebar cannot hide it.
    await expect(page.getByRole('link', { name: 'العربية' })).toBeVisible();
  });

  test('is reachable by keyboard and carries an accessible name', async ({ page }) => {
    await page.goto(ADMIN);
    const link = page.getByRole('link', { name: 'العربية' });
    await link.focus();
    await expect(link).toBeFocused();
    // A human-readable endonym, not a locale code and not a flag.
    await expect(link).toHaveAttribute('hreflang', 'ar');
  });
});
