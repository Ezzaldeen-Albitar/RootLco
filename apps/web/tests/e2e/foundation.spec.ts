import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Foundation smoke.
 *
 * Runs against a real production build in a real browser. Everything here is a
 * property of the FRAME — direction, landmarks, keyboard reachability, the
 * table's controls, the overlay focus contract, print emulation — because the
 * frame is what P1-25 delivers.
 */

/**
 * Collects console errors and page errors for the life of a page.
 *
 * A hydration mismatch appears as a console error and nothing else: the page
 * looks correct, React has silently thrown away the server tree and re-rendered.
 * Asserting on an empty console is the only way a test sees it.
 */
function watchConsole(page: Page): { readonly errors: string[] } {
  const errors: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return { errors };
}

test.describe('locale routes', () => {
  test('English is LTR and Arabic is RTL, decided by the server', async ({ page }) => {
    const console = watchConsole(page);

    await page.goto('/en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    await page.goto('/ar');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    expect(console.errors, 'the console must be clean').toEqual([]);
  });

  test('the root redirects to a locale', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/(ar|en)$/);
  });
});

test.describe('the shell', () => {
  test('has the landmarks a screen reader navigates by', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();
  });

  test('the skip link is the first thing a keyboard reaches, and it works', async ({ page }) => {
    await page.goto('/en');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    // Focus must MOVE to main. Without tabIndex={-1} the browser scrolls there
    // and leaves focus behind, so the next Tab returns to the navigation.
    await expect(page.locator('#main')).toBeFocused();
  });

  test('does not scroll horizontally at any reviewed width', async ({ page }) => {
    await page.goto('/en');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflow, 'the page body must never scroll horizontally').toBe(false);
  });

  test('renders no planned module as a link', async ({ page }) => {
    await page.goto('/en');
    const nav = page.getByRole('navigation', { name: 'Modules' });
    await expect(nav.getByRole('link', { name: 'Overview' })).toBeVisible();
    // Every other module is planned, so it must not be clickable.
    await expect(nav.getByRole('link', { name: 'Billing' })).toHaveCount(0);
  });
});

test.describe('the gallery', () => {
  test('renders every section in English with a clean console', async ({ page }) => {
    const console = watchConsole(page);
    await page.goto('/en/gallery');
    await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible();
    for (const section of [
      'Foundations',
      'Controls',
      'Data table',
      'Application states',
      'Print',
    ]) {
      // level 2 scopes this to the SECTION headings; the print document renders
      // its own h1 with the word "Print" in it.
      await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible();
    }
    expect(console.errors).toEqual([]);
  });

  test('renders in Arabic RTL with a clean console', async ({ page }) => {
    const console = watchConsole(page);
    await page.goto('/ar/gallery');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'معرض المكوّنات' })).toBeVisible();
    expect(console.errors).toEqual([]);
  });

  test('the table sorts, pages and reports its range', async ({ page }) => {
    await page.goto('/en/gallery');
    const table = page.getByRole('table', { name: 'Data table' });
    await expect(table).toBeVisible();

    // Scoped to the data table: the print sample further down the page renders a
    // second table with the same column name.
    const header = table.getByRole('columnheader', { name: /Reference/ });
    await expect(header).toHaveAttribute('aria-sort', 'none');
    await header.getByRole('button').click();
    await expect(table.getByRole('columnheader', { name: /Reference/ })).toHaveAttribute(
      'aria-sort',
      'ascending'
    );

    await expect(page.getByText(/Showing/)).toContainText('5');
    await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  });

  test('a dialog traps focus and restores it on Escape', async ({ page }) => {
    await page.goto('/en/gallery');
    const trigger = page.getByRole('button', { name: 'Open dialog' });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    for (let index = 0; index < 6; index += 1) {
      await page.keyboard.press('Tab');
      const inside = await dialog.evaluate((node) => node.contains(document.activeElement));
      expect(inside, `focus escaped after ${index + 1} tabs`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('a destructive confirmation focuses Cancel, not the destructive action', async ({
    page,
  }) => {
    await page.goto('/en/gallery');
    await page.getByRole('button', { name: 'Delete something' }).click();
    const alert = page.getByRole('alertdialog');
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Cancel' })).toBeFocused();
  });

  test('the reason confirmation refuses an empty reason', async ({ page }) => {
    await page.goto('/en/gallery');
    await page.getByRole('button', { name: 'Refuse with a reason' }).click();
    const alert = page.getByRole('alertdialog');
    await expect(alert.getByRole('button', { name: 'Refuse with a reason' })).toBeDisabled();
    await alert.getByRole('textbox').fill('   ');
    await expect(alert.getByRole('button', { name: 'Refuse with a reason' })).toBeDisabled();
    await alert.getByRole('textbox').fill('parts unavailable');
    await expect(alert.getByRole('button', { name: 'Refuse with a reason' })).toBeEnabled();
  });

  test('a toast is announced from a live region', async ({ page }) => {
    await page.goto('/en/gallery');
    await page.getByRole('button', { name: 'Show a notification' }).click();
    const region = page.getByRole('region', { name: 'Notifications' });
    await expect(region).toHaveAttribute('aria-live', 'polite');
    await expect(region).toContainText('Saved');
  });

  test('the money field keeps a decimal string exactly', async ({ page }) => {
    await page.goto('/en/gallery');
    const amount = page.getByLabel(/Amount/).first();
    await amount.fill('12.5');
    await amount.blur();
    // Canonicalised by padding characters, not by arithmetic.
    await expect(amount).toHaveValue('12.5000');
  });
});

test.describe('print emulation', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`hides interactive chrome on paper in ${locale}`, async ({ page }) => {
      await page.goto(`/${locale}/gallery`);
      await page.emulateMedia({ media: 'print' });

      // A CSS locator, not a role locator: under print media the navigation is
      // display:none, so it is absent from the accessibility tree and a role
      // query waits for it forever. Asking the DOM directly is what actually
      // answers "is this hidden on paper".
      const navHidden = await page
        .locator('nav')
        .first()
        .evaluate((node) => globalThis.getComputedStyle(node).display === 'none');
      expect(navHidden, 'navigation must not print').toBe(true);

      const document = page.locator('[data-print="document"]');
      await expect(document).toBeVisible();
      const clipped = await document.evaluate((node) => node.scrollWidth > node.clientWidth + 1);
      expect(clipped, 'the printed document must not clip horizontally').toBe(false);

      await page.emulateMedia({ media: 'screen' });
    });
  }
});

test.describe('reduced motion', () => {
  test('collapses every transition duration to zero', async ({ page }) => {
    test.skip(test.info().project.name !== 'reduced-motion', 'runs in the reduced-motion project');
    await page.goto('/en/gallery');
    // The token layer does this once, so a component written later inherits it
    // without knowing the preference exists.
    const durations = await page.evaluate(() => {
      const style = globalThis.getComputedStyle(document.documentElement);
      return ['instant', 'fast', 'base', 'slow', 'overlay'].map((name) =>
        style.getPropertyValue(`--duration-${name}`).trim()
      );
    });
    // Zero, not the literal string '0ms': the CSS minifier normalises '0ms' to
    // '0s', so asserting the exact text would fail on a correctly collapsed
    // token and pass only by accident of build settings.
    expect(durations).toHaveLength(5);
    for (const value of durations) {
      expect(value, 'a duration token did not collapse').toMatch(/^0(ms|s)$/);
    }
  });
});
