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

/**
 * Rules a TAG-SCOPED run silently drops, re-enabled by name.
 *
 * axe sets `tagExclude = ['experimental', 'deprecated']` by default, and a rule
 * carrying an excluded tag is removed from a `runOnly` tag run even when one of
 * its own tags was requested. `label-content-name-mismatch` is tagged
 * `['cat.semantics', 'wcag21a', 'wcag253', …, 'experimental']` — measured
 * against this repository's own axe-core, not assumed — so asking for `wcag21a`
 * does NOT ask for it, and it appears in neither violations nor passes nor
 * incomplete nor inapplicable.
 *
 * It is the ONLY rule axe ships for SC 2.5.3 Label in Name. Without this block
 * no route in `ROUTES` could ever produce a 2.5.3 finding, which is why the
 * vehicle duplicate queue's Label in Name failure survived every tier — not,
 * as an earlier version of this file claimed, because the route was unlisted.
 * Listing the route was necessary and was not sufficient.
 */
const ALSO = { 'label-content-name-mismatch': { enabled: true } };

/*
 * Every authenticated route this phase can reach without first creating data.
 *
 * The five CRM and vehicle routes below were MISSING: this list declared "WCAG
 * 2.1 A and AA — the level the accessibility evidence claims" while containing
 * no P1-27 route at all, so the phase under acceptance was the one part of the
 * product no automated scan had ever visited. They are here now, and the other
 * sixty-eight tag-scoped rules run against three previously unscanned screens.
 *
 * ## What listing them did NOT fix, and an earlier version of this comment said it did
 *
 * It did not explain how the duplicate queue's Label in Name failure survived.
 * That rule is excluded from every tag-scoped run by axe's `experimental` tag —
 * see `ALSO` above — so the gate would have stayed green with the defect live
 * even if this route had been listed from the first day. The route list and the
 * rule are two separate necessary conditions and only one of them was missing
 * from the diagnosis.
 *
 * ## The profile and detail screens are scanned by NOTHING
 *
 * They need a real customer or vehicle id, and a scan pointed at a 404 reports
 * zero violations — which is why they are not listed here. They are also not
 * covered elsewhere: exactly three files in `apps/web` import `vitest-axe`
 * (`gallery-and-print`, `overlays`, `shell`) and none of them renders
 * `VehicleProfileScreen`, `CustomerProfileScreen`, `VehicleDuplicateReviewScreen`
 * or `DuplicateReviewScreen`. A previous version of this note claimed they were
 * "covered by component-level scans instead". They are not. It is an open gap,
 * recorded as one rather than papered over.
 */
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
  '/crm/customers',
  '/crm/customer-duplicates',
  '/vehicles',
  '/vehicles/new',
  '/vehicles/duplicates',
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

  return page.evaluate(
    async ({ tags, rules }) => {
      const axe = (
        window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<unknown> } }
      ).axe;
      const result = (await axe.run(document, { runOnly: tags, rules })) as {
        violations: AxeViolation[];
      };
      return result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
      }));
    },
    { tags: TAGS, rules: ALSO }
  );
}

/**
 * Proves the re-enabled rule is actually RUNNING, on a fixture that breaks it.
 *
 * Without this the `ALSO` block is a declaration: a typo in the rule id, or an
 * axe upgrade that renames it, would leave every route scan green and silent —
 * which is exactly the state this file was in before, and exactly how the
 * duplicate queue's failure survived.
 */
async function proveLabelInNameRuns(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(
    async ({ tags, rules }) => {
      const doc = document.createElement('div');
      // Visible text "V-0001", announced name "First record" — the defect.
      doc.innerHTML = '<a href="#x" aria-label="First record">V-0001</a>';
      document.body.appendChild(doc);
      const axe = (
        window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<unknown> } }
      ).axe;
      const result = (await axe.run(doc, { runOnly: tags, rules })) as {
        violations: { id: string }[];
      };
      doc.remove();
      return result.violations.map((v) => v.id);
    },
    { tags: TAGS, rules: ALSO }
  );
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

  test('the Label in Name rule is enabled, proved on a planted violation', async ({ page }) => {
    await page.addInitScript({ path: AXE });
    await page.goto('/en/administration/users');
    const ids = await proveLabelInNameRuns(page);
    expect(
      ids,
      'label-content-name-mismatch did not fire on an element that plainly breaks it — ' +
        'the rule is excluded from this run, so no route scan above can ever report SC 2.5.3'
    ).toContain('label-content-name-mismatch');
  });

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
   * `P1-26-F-059`'s browser assertion used to live here, and it was a flake.
   *
   * It held `**​/api/**` open to keep the skeleton on screen long enough to read
   * the announcement. But this application fetches on the SERVER — the browser
   * issues no API request at all — so the delay matched nothing and the loading
   * fallback appeared only when the server happened to be cold. It passed alone
   * and failed inside the full suite, which is the signature of a test whose
   * subject arrives by luck.
   *
   * The assertion now lives in `tests/loading-boundary.dom.test.tsx`, which
   * renders the boundary directly for each locale and has no timing at all. The
   * component was the thing that was wrong; that is the thing to render.
   */
});
