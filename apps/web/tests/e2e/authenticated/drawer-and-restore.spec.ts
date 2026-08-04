import { expect, test } from '@playwright/test';

/**
 * The tablet drawer, and the scroll restoration the scroll-ownership change owed.
 *
 * Both live here rather than in the component tier for the same reason as the
 * rest of the shared-UX contract: jsdom has no layout engine and no history, so
 * "the last item is reachable" and "Back returns you where you were" are not
 * questions it can answer.
 *
 * The drawer in particular had never been measured at all. Every existing
 * browser assertion ran at 1440, 1280 or 1024 wide and 900 tall — and the drawer
 * does not exist above `lg`, so an entire navigation surface was invisible to
 * the suite that was supposed to cover navigation.
 */

const ADMIN = '/en/administration/users';
/** Below `lg`, so the sidebar is a drawer rather than a rail. */
const TABLET = { width: 900, height: 700 };

test.describe('the tablet navigation drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(TABLET);
    await page.goto(ADMIN);
    await expect(page.getByRole('button', { name: /open navigation/i })).toBeVisible();
  });

  test('does not steal focus on load', async ({ page }) => {
    // `P1-26-F-073`. The focus effect ran on MOUNT with the drawer closed and
    // took the "closed" branch, so every page load below `lg` put focus on the
    // hamburger — past the skip link, and announced before the page could say
    // what it was.
    const active = await page.evaluate(() => ({
      tag: document.activeElement?.tagName ?? null,
      label: document.activeElement?.getAttribute('aria-label') ?? null,
      isBody: document.activeElement === document.body,
    }));
    expect(active.isBody, `focus was on ${active.tag}[${active.label}]`).toBe(true);
  });

  test('fits the viewport, and its navigation scrolls inside it', async ({ page }) => {
    await page.getByRole('button', { name: /open navigation/i }).click();
    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();

    const measured = await page.evaluate(() => {
      const el = document.querySelector('[role="dialog"][aria-modal="true"]')!;
      const nav = el.querySelector('nav')!;
      const panelRect = el.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      return {
        panelBottom: Math.round(panelRect.bottom),
        navBottom: Math.round(navRect.bottom),
        viewportHeight: document.documentElement.clientHeight,
        navScrolls: nav.scrollHeight > nav.clientHeight + 1,
        navOverflowY: getComputedStyle(nav).overflowY,
      };
    });

    // The panel is the viewport, and the navigation lives inside it. Before the
    // fix the close row took 56px off the top while the navigation below it
    // still asked for the whole viewport, so the content ran past the bottom.
    expect(measured.panelBottom).toBeLessThanOrEqual(measured.viewportHeight + 1);
    expect(measured.navBottom).toBeLessThanOrEqual(measured.panelBottom + 1);
    expect(measured.navOverflowY).toBe('auto');
    expect(measured.navScrolls, 'fifteen modules cannot fit 700px').toBe(true);
  });

  test('keeps its last module reachable and its brand visible', async ({ page }) => {
    await page.getByRole('button', { name: /open navigation/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const measured = await page.evaluate(() => {
      const el = document.querySelector('[role="dialog"][aria-modal="true"]')!;
      const nav = el.querySelector('nav')!;
      const links = [...nav.querySelectorAll('a')];
      const last = links[links.length - 1];
      // Reachable, not merely visible — scrolling to it is what a person does.
      last?.scrollIntoView({ block: 'nearest' });
      const lastRect = last?.getBoundingClientRect();
      const brand = el.querySelector('div.h-16')?.getBoundingClientRect();
      const vh = document.documentElement.clientHeight;
      return {
        links: links.length,
        lastWithinViewport: lastRect ? lastRect.bottom <= vh + 1 && lastRect.top >= -1 : false,
        brandVisible: brand ? brand.top >= -1 && brand.bottom <= vh : false,
      };
    });

    expect(measured.links).toBeGreaterThan(5);
    expect(measured.lastWithinViewport, 'the last module must be reachable').toBe(true);
    expect(measured.brandVisible, 'the brand must not scroll away with the list').toBe(true);
  });

  test('traps Tab, so aria-modal is not a lie', async ({ page }) => {
    // `P1-26-F-074`. The panel declared `aria-modal="true"` — which tells
    // assistive technology the rest of the page is inert — while Tab walked
    // straight out of it into content the user could not see.
    await page.getByRole('button', { name: /open navigation/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.evaluate(() => {
      const panel = document.querySelector('[role="dialog"][aria-modal="true"]')!;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])'
      );
      focusable[focusable.length - 1]?.focus();
    });
    await page.keyboard.press('Tab');

    const stillInside = await page.evaluate(() => {
      const panel = document.querySelector('[role="dialog"][aria-modal="true"]');
      return panel ? panel.contains(document.activeElement) : false;
    });
    expect(stillInside, 'Tab from the last item must wrap, not escape').toBe(true);
  });

  test('returns focus to the trigger when it closes', async ({ page }) => {
    const trigger = page.getByRole('button', { name: /open navigation/i });
    await trigger.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('has a visible edge that survives forced colours', async ({ page }) => {
    await page.getByRole('button', { name: /open navigation/i }).click();
    const border = await page
      .getByRole('dialog')
      .evaluate((el) => getComputedStyle(el).borderInlineEndWidth);
    // A shadow alone is dropped under forced colours and in print, so the panel
    // needs a real border width, not only a border colour.
    expect(border).not.toBe('0px');
  });
});

test.describe('scroll restoration', () => {
  test('Back returns the operator to where they were', async ({ page }) => {
    // The debt incurred by moving the scroll out of the document: browsers
    // restore `window.scrollY` for free and a `<div>`'s `scrollTop` never.
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto('/en/administration/permissions');
    await expect(page.getByRole('table').first()).toBeVisible();

    await page.evaluate(() => {
      document.getElementById('main')!.scrollTop = 1500;
    });
    // The recorder coalesces at 150ms.
    await page.waitForTimeout(400);
    const left = await page.evaluate(() => document.getElementById('main')!.scrollTop);
    expect(left).toBeGreaterThan(1000);

    // A CLIENT-SIDE navigation. `page.goto` is a document load and does not fire
    // `popstate`, so it would exercise a path the application never takes.
    await page
      .getByRole('navigation', { name: 'Modules' })
      .getByRole('link', { name: 'Users' })
      .click();
    await page.waitForURL(/\/en\/administration\/users/);

    const forward = await page.evaluate(() => document.getElementById('main')!.scrollTop);
    expect(forward, 'a forward navigation starts at the top').toBeLessThanOrEqual(2);

    await page.goBack();
    await page.waitForURL(/\/en\/administration\/permissions/);
    await expect(page.getByRole('table').first()).toBeVisible();

    await expect
      .poll(async () => page.evaluate(() => document.getElementById('main')!.scrollTop), {
        timeout: 5000,
      })
      .toBeGreaterThan(left - 60);
  });
});
