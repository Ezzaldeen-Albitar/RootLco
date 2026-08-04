import { expect, test } from '@playwright/test';

/**
 * The shared-UX contract on the screens reached WITHOUT a session.
 *
 * Sign-in is the one place the scroll contract is deliberately different: the
 * document still must not scroll, but the authentication column owns a scroll
 * region of its own so a short viewport — or a software keyboard — cannot clip
 * the form. These cases hold that exception to exactly one region.
 */

const TOLERANCE = 2;

test.describe('the sign-in language control', () => {
  test('is visible, named in its own language, and is not a flag or a code', async ({ page }) => {
    await page.goto('/en/login');
    const arabic = page.getByRole('link', { name: 'العربية' });
    const english = page.getByRole('link', { name: 'English' });
    await expect(arabic).toBeVisible();
    await expect(english).toBeVisible();
    // An endonym, not `ar`, and not a flag: a flag names a country, and Arabic
    // is spoken in many.
    await expect(arabic).toHaveAttribute('hreflang', 'ar');
  });

  test('switches English to Arabic and back, staying on the sign-in screen', async ({ page }) => {
    await page.goto('/en/login');
    await page.getByRole('link', { name: 'العربية' }).click();
    await page.waitForURL(/\/ar\/login$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'تسجيل الدخول' })).toBeVisible();

    await page.getByRole('link', { name: 'English' }).click();
    await page.waitForURL(/\/en\/login$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  });

  test('is reachable by keyboard', async ({ page }) => {
    await page.goto('/en/login');
    const link = page.getByRole('link', { name: 'العربية' });
    await link.focus();
    await expect(link).toBeFocused();
  });
});

test.describe('the sign-in scroll exception', () => {
  test('does not scroll the document, at any of the reviewed heights', async ({ page }) => {
    for (const height of [900, 700, 560, 420]) {
      await page.setViewportSize({ width: 1280, height });
      await page.goto('/en/login');
      await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

      const moved = await page.evaluate(() => {
        const de = document.documentElement;
        de.scrollTop = 99_999;
        const reached = de.scrollTop;
        de.scrollTop = 0;
        return reached;
      });
      expect(moved, `the document must not scroll at ${height}px`).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  test('keeps the form reachable on a short viewport through ONE scroll region', async ({
    page,
  }) => {
    // 375x420 is the shape a phone takes with a keyboard open. The form must be
    // reachable, and it must be reachable by scrolling exactly one thing —
    // nested vertical scrollers on a sign-in screen are how a person ends up
    // unable to reach the button at all.
    await page.setViewportSize({ width: 375, height: 420 });
    await page.goto('/en/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

    const measured = await page.evaluate(() => {
      const scrollers = [...document.querySelectorAll('*')].filter((el) => {
        const overflowY = getComputedStyle(el).overflowY;
        return (
          (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1
        );
      });
      const main = document.querySelector('main#main');
      if (main) main.scrollTop = 99_999;
      const submit = document.querySelector('button[type="submit"]');
      const rect = submit?.getBoundingClientRect();
      return {
        scrollerCount: scrollers.length,
        scrollerIsMain: scrollers.length === 1 && scrollers[0] === main,
        submitWithinViewport: rect
          ? rect.top >= 0 && rect.bottom <= document.documentElement.clientHeight + 1
          : false,
      };
    });

    expect(measured.scrollerCount, 'exactly one scroll region on the sign-in screen').toBe(1);
    expect(measured.scrollerIsMain, 'and it is the form column, not the decorative panel').toBe(
      true
    );
    expect(measured.submitWithinViewport, 'the submit control must be reachable').toBe(true);
  });

  test('mounts the notification authority here too, fixed to the viewport', async ({ page }) => {
    // A sign-in failure is an operation result like any other, so the authority
    // has to exist before a session does.
    await page.goto('/en/login');
    const region = page.getByTestId('notification-region');
    await expect(region).toHaveCount(1);
    const position = await region.evaluate((el) => getComputedStyle(el).position);
    expect(position).toBe('fixed');
  });
});
