import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { flattenNavigation } from '@/config/navigation';
import { ADMINISTRATION_PERMISSIONS } from '@/features/administration/shared/permissions';
import { renderLtr, renderRtl } from './render';

/**
 * The administration hub (`P1-32-PRE-OD-ADM6`).
 *
 * The properties under test: departments and employees are offered beside
 * users; every entry is shown exactly when its page would draw something other
 * than a refusal — its navigation entry's code, plus any further code the page
 * refuses without — and hidden when that code is missing, so no entry is a door
 * an administrator holding the route's code cannot open, and none opens onto a
 * refusal; the labels are the catalogue's in both languages.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({ permissions: PERMISSIONS, email: 'reviewer@test.local' }),
}));

type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const AdministrationPage = (await import('@/app/[locale]/(dashboard)/administration/page'))
  .default as unknown as RoutePage;

/**
 * Codes a page refuses without, beyond its navigation entry's own — read from
 * the pages themselves: departments and employees list one branch's records and
 * refuse without the branch read.
 */
const PAGE_ALSO_REQUIRES: Record<string, readonly string[]> = {
  '/administration/departments': ['org.branch.read'],
  '/administration/employees': ['org.branch.read'],
};

async function hubHrefs(
  permissions: readonly string[],
  locale: 'en' | 'ar' = 'en'
): Promise<string[]> {
  PERMISSIONS = permissions;
  const ui = (await AdministrationPage({ params: Promise.resolve({ locale }) })) as never;
  const view = locale === 'en' ? renderLtr(ui) : renderRtl(ui);
  const hrefs = screen
    .queryAllByRole('link')
    .map((link) => link.getAttribute('href') ?? '')
    .filter((href) => href.startsWith(`/${locale}/administration/`))
    .map((href) => href.slice(`/${locale}`.length));
  view.unmount();
  return hrefs;
}

beforeEach(() => {
  PERMISSIONS = [];
});

describe('departments and employees on the hub', () => {
  it('offers both to an administrator holding their codes, under People and access', async () => {
    PERMISSIONS = ['org.department.read', 'org.employee.read', 'org.branch.read'];
    renderLtr((await AdministrationPage({ params: Promise.resolve({ locale: 'en' }) })) as never);
    expect(
      screen.getByRole('heading', { name: EN['admin.section.identity'] as string })
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: new RegExp(`^${EN['nav.departments']}`) })
    ).toHaveAttribute('href', '/en/administration/departments');
    expect(
      screen.getByRole('link', { name: new RegExp(`^${EN['nav.employees']}`) })
    ).toHaveAttribute('href', '/en/administration/employees');
  });

  it('names both in Arabic, right to left', async () => {
    PERMISSIONS = ['org.department.read', 'org.employee.read', 'org.branch.read'];
    renderRtl((await AdministrationPage({ params: Promise.resolve({ locale: 'ar' }) })) as never);
    expect(
      screen.getByRole('link', { name: new RegExp(`^${AR['nav.departments']}`) })
    ).toHaveAttribute('href', '/ar/administration/departments');
    expect(
      screen.getByRole('link', { name: new RegExp(`^${AR['nav.employees']}`) })
    ).toHaveAttribute('href', '/ar/administration/employees');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('hides each without its own code, and both without the branch read their pages refuse without', async () => {
    expect(await hubHrefs(['org.employee.read', 'org.branch.read'])).toEqual([
      '/administration/employees',
    ]);
    expect(await hubHrefs(['org.department.read', 'org.branch.read'])).toEqual([
      '/administration/departments',
    ]);
    expect(await hubHrefs(['org.department.read', 'org.employee.read'])).toEqual([]);
  });

  it('offers no technician roster, because no roster route exists', async () => {
    expect(await hubHrefs([...ADMINISTRATION_PERMISSIONS, 'tech.technician.read'])).not.toContain(
      '/technicians'
    );
  });
});

describe('every hub entry is gated as its route is', () => {
  const navigation = flattenNavigation();

  it('shows nothing to a session holding no administration code', async () => {
    expect(await hubHrefs([])).toEqual([]);
  });

  it('matches each entry to its navigation entry, shows it on that code alone, and hides it without', async () => {
    const all = [...ADMINISTRATION_PERMISSIONS];
    const offered = await hubHrefs(all);
    expect(offered).toEqual(
      expect.arrayContaining([
        '/administration/users',
        '/administration/departments',
        '/administration/employees',
        '/administration/audit-log',
      ])
    );
    for (const href of offered) {
      const item = navigation.find((entry) => entry.href === href);
      expect(item, `${href} has a navigation entry`).toBeDefined();
      const code = item?.permission as string;
      const minimal = [code, ...(item?.alsoRequires ?? []), ...(PAGE_ALSO_REQUIRES[href] ?? [])];
      expect(await hubHrefs(minimal), `${href} is shown on ${minimal.join(', ')}`).toContain(href);
      expect(
        await hubHrefs(all.filter((held) => held !== code)),
        `${href} is hidden without ${code}`
      ).not.toContain(href);
    }
  });
});
