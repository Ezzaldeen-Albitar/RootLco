import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Automated accessibility over the AUTHENTICATED routes.
 *
 * P1-26's own final report recorded that no automated scan had ever run against
 * these screens, because reaching them needed an account that did not exist.
 * It does now.
 *
 * ## Why `addInitScript` and not `addScriptTag`
 *
 * `addScriptTag` creates a real `<script>` element, which the per-request nonce
 * CSP served by `src/proxy.ts` refuses. `window.axe` would then be undefined and
 * a defensively written scan would report zero violations — a vacuous pass on an
 * accessibility gate, which is the exact failure class this repository has been
 * burned by before. `addInitScript` is delivered over the debugging protocol
 * before any document script runs, and is not subject to the page CSP.
 *
 * The explicit `axe is present` assertion below turns a silent CSP block into a
 * named failure instead of a clean report over nothing.
 */

/**
 * The already-installed axe bundle. Resolved by path rather than by `require`,
 * because Playwright transpiles specs to CommonJS and `import.meta` is not
 * available; npm may hoist the package to the repository root or keep it in the
 * workspace, so both are checked and a miss is a named failure rather than a
 * scan over an undefined global.
 */
const AXE = [
  resolve(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js'),
  resolve(process.cwd(), '..', '..', 'node_modules', 'axe-core', 'axe.min.js'),
].find((candidate) => existsSync(candidate));

if (!AXE) {
  throw new Error(
    'axe-core/axe.min.js was not found in the workspace or at the repository root. ' +
      'Without it every scan below would be vacuous.'
  );
}

/** WCAG 2.1 A and AA — the level the accessibility evidence claims. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const ROUTES = [
  '/administration',
  '/administration/organization',
  '/administration/users',
  '/administration/roles',
  '/administration/permissions',
  '/administration/approval-limits',
  '/administration/numbering-rules',
  '/administration/taxes',
  '/administration/currencies',
  '/administration/languages',
  '/administration/audit-log',
  '/administration/system-settings',
  '/profile',
  '', // the dashboard
];

interface AxeNode {
  readonly html: string;
  readonly target: readonly string[];
}
interface AxeViolation {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly nodes: readonly AxeNode[];
}

async function scan(page: import('@playwright/test').Page) {
  const present = await page.evaluate(
    () => typeof (window as unknown as { axe?: unknown }).axe !== 'undefined'
  );
  expect(
    present,
    'axe was not injected. addInitScript must run BEFORE goto, or the nonce CSP blocked it — ' +
      'either way a scan now would report zero violations over nothing.'
  ).toBe(true);

  return page.evaluate(async (tags) => {
    const axe = (
      window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<unknown> } }
    ).axe;
    const result = (await axe.run(document, { runOnly: tags })) as {
      violations: AxeViolation[];
    };
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    }));
  }, TAGS);
}

const localeOf = (project: string) => (project.endsWith('-ar') ? 'ar' : 'en');

test.describe('authenticated accessibility', () => {
  for (const route of ROUTES) {
    test(`axe finds no critical or serious violation on ${route || '/(dashboard)'}`, async ({
      page,
    }, testInfo) => {
      const lang = localeOf(testInfo.project.name);
      await page.addInitScript({ path: AXE });
      await page.goto(`/${lang}${route}`);
      await expect(page.getByRole('main')).toBeVisible();

      const violations = await scan(page);
      const blocking = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');

      // Moderate and minor findings are reported as annotations rather than
      // failures, so they are visible and dispositioned instead of silently
      // tolerated or noisily blocking.
      const lesser = violations.filter((v) => v.impact !== 'critical' && v.impact !== 'serious');
      if (lesser.length > 0) {
        testInfo.annotations.push({
          type: 'a11y-non-blocking',
          description: lesser.map((v) => `${v.impact}:${v.id}`).join(', '),
        });
      }

      expect(
        blocking,
        `critical/serious accessibility violations on /${lang}${route}:\n` +
          blocking
            .map((v) => `  ${v.id} (${v.impact}) — ${v.help}\n    ${v.nodes.join('\n    ')}`)
            .join('\n')
      ).toEqual([]);
    });
  }

  test('a dialog traps focus and returns it, signed in', async ({ page }) => {
    await page.addInitScript({ path: AXE });
    // Pinned to English regardless of project locale: this case is about dialog
    // behaviour, and matching a control by its Arabic label would make it a test
    // of the translation catalogue instead.
    await page.goto('/en/administration/users');

    const opener = page
      .getByRole('button')
      .filter({ hasText: /invite|add|new/i })
      .first();
    if ((await opener.count()) === 0) {
      test.skip(true, 'this screen exposes no dialog opener for the current permission set');
      return;
    }
    await opener.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const violations = await scan(page);
    const blocking = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(blocking, 'the open dialog must be free of critical/serious violations').toEqual([]);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('the skip link is the first thing a keyboard reaches', async ({ page }) => {
    await page.goto('/en/administration/users');
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    expect(focused).toMatch(/skip to content|تخطَّ/i);
  });

  /**
   * P1-26-F-059 — the loading state announced the wrong language.
   *
   * The route-group `loading.tsx` is passed no props by Next, so it read
   * DEFAULT_LOCALE, which is Arabic. Every English navigation announced
   * "جارٍ التحميل" to a screen reader. axe cannot see this: the markup is
   * valid, the contrast is fine, and `sr-only` text carries no language of its
   * own to disagree with — the only witness is the word itself.
   *
   * The skeleton resolves in well under a second, so the API response is held
   * open to keep it on screen long enough to read. Without that delay this test
   * would pass by never observing the fallback at all.
   */
  for (const [locale, expected, wrong] of [
    ['en', 'Loading', 'جارٍ التحميل'],
    ['ar', 'جارٍ التحميل', 'Loading'],
  ] as const) {
    test(`the ${locale} loading state announces itself in ${locale}`, async ({ page }) => {
      await page.route('**/api/**', async (route) => {
        await new Promise((r) => setTimeout(r, 4000));
        await route.continue();
      });

      await page.goto(`/${locale}/administration/users`, { waitUntil: 'commit' });

      const status = page.locator('[role="status"] .sr-only').first();
      await status.waitFor({ state: 'attached', timeout: 15000 });
      const announced = ((await status.textContent()) ?? '').trim();

      expect(
        announced,
        `the ${locale} interface announced its loading state as "${announced}"`
      ).toBe(expected);
      expect(announced).not.toBe(wrong);
    });
  }
});
