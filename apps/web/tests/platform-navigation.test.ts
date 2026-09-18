import { describe, expect, it } from 'vitest';
import { NAVIGATION, flattenNavigation } from '@/config/navigation';
import { PLATFORM_NAVIGATION } from '@/config/platform-navigation';
import { PLATFORM_PERMISSIONS, holds } from '@/features/platform/permissions';
import { auditActionKey, usagePercent, usageWarns } from '@/features/platform/types';
import { visibleNavigation } from '@/lib/permissions';
import en from '../src/i18n/messages/en.json';

/**
 * The Platform Owner Console navigation is its own model, gated by platform
 * authority codes, and filtered by the same function as the workspace
 * (P1-32-PRE-062).
 */

const ITEMS = flattenNavigation(PLATFORM_NAVIGATION);
const CODES = Object.values(PLATFORM_PERMISSIONS);

describe('the console navigation model', () => {
  it('gates every item on a platform authority code the console knows', () => {
    expect(ITEMS.length).toBe(4);
    for (const item of ITEMS) {
      expect(item.permission, item.key).not.toBeNull();
      expect(CODES, `${item.key} names an unknown code`).toContain(item.permission);
      expect(item.href.startsWith('/platform'), item.key).toBe(true);
    }
  });

  it('pins each literal to the permission the page decides on', () => {
    const byKey = Object.fromEntries(ITEMS.map((item) => [item.key, item.permission]));
    expect(byKey).toEqual({
      'platform-overview': PLATFORM_PERMISSIONS.statisticsRead,
      'platform-organizations': PLATFORM_PERMISSIONS.organizationRead,
      'platform-plans': PLATFORM_PERMISSIONS.subscriptionManage,
      'platform-audit': PLATFORM_PERMISSIONS.auditRead,
    });
  });

  it('shares no item, and no permission, with the workspace model', () => {
    const workspace = flattenNavigation(NAVIGATION);
    const workspaceKeys = new Set(workspace.map((item) => item.key));
    for (const item of ITEMS) expect(workspaceKeys.has(item.key), item.key).toBe(false);
    for (const item of workspace) {
      expect(String(item.permission ?? '').startsWith('platform.'), item.key).toBe(false);
    }
  });

  it('labels every item and group with a catalogued message', () => {
    const catalogue = en as Record<string, string>;
    for (const group of PLATFORM_NAVIGATION) expect(catalogue[group.labelKey]).toBeTruthy();
    for (const item of ITEMS) expect(catalogue[item.labelKey], item.labelKey).toBeTruthy();
  });
});

describe('filtering by platform authority', () => {
  it('shows nothing to a session without platform authority', () => {
    expect(visibleNavigation(PLATFORM_NAVIGATION, { permissions: ['iam.user.read'] })).toEqual([]);
  });

  it('shows exactly the items a session holds, and nothing else', () => {
    const groups = visibleNavigation(PLATFORM_NAVIGATION, {
      permissions: [PLATFORM_PERMISSIONS.organizationRead, PLATFORM_PERMISSIONS.auditRead],
    });
    expect(flattenNavigation(groups).map((item) => item.key)).toEqual([
      'platform-organizations',
      'platform-audit',
    ]);
  });

  it('shows every item to a session holding every code', () => {
    const groups = visibleNavigation(PLATFORM_NAVIGATION, { permissions: CODES });
    expect(flattenNavigation(groups)).toHaveLength(ITEMS.length);
  });

  it('never lets a platform code open a workspace item', () => {
    const groups = visibleNavigation(NAVIGATION, { permissions: CODES });
    const gated = flattenNavigation(groups).filter((item) => item.permission !== null);
    expect(gated).toEqual([]);
  });

  it('matches codes exactly', () => {
    expect(holds(['platform.organization.read'], PLATFORM_PERMISSIONS.organizationRead)).toBe(true);
    expect(holds(['platform.organization'], PLATFORM_PERMISSIONS.organizationRead)).toBe(false);
  });
});

describe('console presentation rules', () => {
  it('computes usage share and the warning threshold, and never warns when unlimited', () => {
    expect(usagePercent({ used: 9, limit: 10 })).toBe(90);
    expect(usageWarns({ used: 9, limit: 10 })).toBe(true);
    expect(usageWarns({ used: 8, limit: 10 })).toBe(false);
    expect(usagePercent({ used: 500, limit: null })).toBeNull();
    expect(usageWarns({ used: 500, limit: null })).toBe(false);
    expect(usagePercent({ used: 12, limit: 10 })).toBe(100);
  });

  it('names every known audit action with a catalogued message, and an unknown one neutrally', () => {
    const catalogue = en as Record<string, string>;
    expect(catalogue[auditActionKey('org.tenant.provisioned')]).toBe('Organisation created');
    expect(auditActionKey('something.else')).toBe('platform.audit.action.other');
    expect(catalogue['platform.audit.action.other']).toBeTruthy();
  });
});
