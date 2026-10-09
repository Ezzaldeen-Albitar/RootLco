import { describe, expect, it } from 'vitest';
import {
  INTENDED_PATH_MAX_LENGTH,
  INTENDED_PATH_PARAM,
  isPlatformPath,
  localisedIntendedPath,
  permitsIntendedPath,
  safeIntendedPath,
  sessionEndedPath,
  signInPath,
} from '@/features/authentication/api/intended-path';
import { SESSION_ENDED_SEGMENT } from '@/features/authentication/api/session-ended';

/**
 * The intended path sign-in may return an operator to (P1-32-PRE-OD-AUTHB).
 *
 * Every rejection the allow-list owes is a case of its own, so a regression
 * names the shape it let through. The accepted shapes are asserted beside them:
 * an allow-list that refuses everything passes every rejection case.
 */

describe('safeIntendedPath accepts only a locale-prefixed application path', () => {
  it.each([
    '/en/work-orders',
    '/ar/work-orders',
    '/en/work-orders/2f1c5b3e-6a4d-4b21-9c8e-1f2a3b4c5d6e',
    '/ar/crm/customers/2f1c5b3e-6a4d-4b21-9c8e-1f2a3b4c5d6e',
    '/en/inventory/transfers',
    '/en/administration/users',
    '/en/profile',
    '/en/platform',
    '/ar/platform/organizations',
    '/en/reports/sales_summary',
  ])('accepts %s', (path) => {
    expect(safeIntendedPath(path)).toBe(path);
  });

  it.each([
    ['an absolute address', 'https://evil.example/en/work-orders'],
    ['an absolute address of this origin', 'http://localhost:3100/en/work-orders'],
    ['a protocol-relative address', '//evil.example/en/work-orders'],
    ['a protocol-relative address after the locale', '/en//evil.example'],
    ['a triple slash', '///evil.example'],
    ['a leading backslash', '/\\evil.example'],
    ['a backslash inside the path', '/en\\..\\evil'],
    ['a backslash segment', '/en/work-orders\\x'],
    ['a scheme', 'javascript:alert(1)'],
    ['a scheme after the locale', '/en/javascript:alert(1)'],
    ['a data address', 'data:text/html,hello'],
    ['an encoded slash', '/%2F%2Fevil.example'],
    ['an encoded slash after the locale', '/en/%2F%2Fevil.example'],
    ['an encoded backslash', '/en/%5C%5Cevil.example'],
    ['an encoded scheme', '/en/javascript%3Aalert(1)'],
    ['an encoded dot segment', '/en/%2e%2e/work-orders'],
    ['a doubly encoded slash', '/en/%252F%252Fevil.example'],
    ['a dot-dot segment', '/en/../evil'],
    ['a dot segment', '/en/./work-orders'],
    ['a host after an at sign', '/en@evil.example'],
    ['a query string', '/en/work-orders?status=open'],
    ['a fragment', '/en/work-orders#top'],
    ['a trailing slash', '/en/work-orders/'],
    ['a space', '/en/work orders'],
    ['a tab', '/en/work-orders\t'],
    ['a line break', '/en/work-orders\nLocation: //evil.example'],
    ['a NUL character', '/en/work-orders\u0000'],
    ['a non-ASCII look-alike', '/en/work‐orders'],
    ['a path without a locale', '/work-orders'],
    ['an unsupported locale', '/de/work-orders'],
    ['the workspace root, which is the landing', '/en'],
    ['the workspace root with a slash', '/en/'],
    ['the sign-in page', '/en/login'],
    ['the session-ended handler', `/en/${SESSION_ENDED_SEGMENT}`],
    ['the forgotten-password page', '/en/forgot-password'],
    ['the reset page', '/en/reset-password'],
    ['the activation page', '/en/activate-account'],
    ['an area the application does not have', '/en/not-a-screen'],
    ['the design gallery, which is not a product screen', '/en/gallery'],
    ['an empty string', ''],
    ['a relative path', 'en/work-orders'],
    ['a path past the length bound', `/en/work-orders/${'a'.repeat(INTENDED_PATH_MAX_LENGTH)}`],
  ])('refuses %s', (_label, path) => {
    expect(safeIntendedPath(path)).toBeNull();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an array of paths', ['/en/work-orders']],
    ['an object', { path: '/en/work-orders' }],
  ])('refuses %s, which is not a string', (_label, value) => {
    expect(safeIntendedPath(value)).toBeNull();
  });
});

describe('the addresses that carry it', () => {
  it('puts a safe path into the sign-in address, encoded', () => {
    expect(signInPath('en', 'signed-out', '/en/work-orders')).toBe(
      `/en/login?reason=signed-out&${INTENDED_PATH_PARAM}=%2Fen%2Fwork-orders`
    );
    expect(signInPath('ar', 'expired', '/ar/work-orders')).toBe(
      `/ar/login?reason=expired&${INTENDED_PATH_PARAM}=%2Far%2Fwork-orders`
    );
  });

  it('drops an unsafe path and keeps the address it always had', () => {
    expect(signInPath('en', 'signed-out', '//evil.example')).toBe('/en/login?reason=signed-out');
    expect(signInPath('en', 'expired', 'https://evil.example')).toBe('/en/login?reason=expired');
    expect(signInPath('en', 'expired')).toBe('/en/login?reason=expired');
  });

  it('puts a safe path into the session-ended address, and drops an unsafe one', () => {
    expect(sessionEndedPath('en', '/en/invoices')).toBe(
      `/en/${SESSION_ENDED_SEGMENT}?${INTENDED_PATH_PARAM}=%2Fen%2Finvoices`
    );
    expect(sessionEndedPath('en', '/\\evil.example')).toBe(`/en/${SESSION_ENDED_SEGMENT}`);
    expect(sessionEndedPath('ar')).toBe(`/ar/${SESSION_ENDED_SEGMENT}`);
  });

  it('moves a path to the language the operator signed in with', () => {
    expect(localisedIntendedPath('/ar/work-orders/abc', 'en')).toBe('/en/work-orders/abc');
    expect(localisedIntendedPath('/en/platform', 'ar')).toBe('/ar/platform');
  });

  it('tells a console path from a workspace path', () => {
    expect(isPlatformPath('/en/platform')).toBe(true);
    expect(isPlatformPath('/en/platform/organizations')).toBe(true);
    expect(isPlatformPath('/en/work-orders')).toBe(false);
    expect(isPlatformPath('/en/profile')).toBe(false);
  });
});

describe('permitsIntendedPath — only a page the new session may open', () => {
  it('allows a workspace page whose entry the session holds', () => {
    expect(permitsIntendedPath('/en/work-orders', ['wo.work_order.read'])).toBe(true);
    expect(permitsIntendedPath('/en/work-orders/abc', ['wo.work_order.read'])).toBe(true);
  });

  it('refuses a workspace page whose entry the session does not hold', () => {
    expect(permitsIntendedPath('/en/work-orders', ['quo.quotation.read'])).toBe(false);
    expect(permitsIntendedPath('/en/administration/users', ['wo.work_order.read'])).toBe(false);
  });

  it('judges a page by its most specific entry, not by a visible parent', () => {
    // The inventory overview is visible to this session; the transfers entry is
    // gated by a code it does not hold, and a page must never be reached through
    // the broader entry above it.
    const overviewOnly = ['inv.item.read'];
    expect(permitsIntendedPath('/en/inventory', overviewOnly)).toBe(true);
    expect(permitsIntendedPath('/en/inventory/transfers', overviewOnly)).toBe(false);
  });

  it('allows the signed-in account its own profile whatever it holds', () => {
    expect(permitsIntendedPath('/en/profile', ['quo.quotation.read'])).toBe(true);
  });

  it('refuses a session holding nothing', () => {
    expect(permitsIntendedPath('/en/work-orders', [])).toBe(false);
  });

  it('refuses a console page to a workspace session, and the reverse', () => {
    expect(permitsIntendedPath('/en/platform', ['wo.work_order.read'], 'workspace')).toBe(false);
    expect(permitsIntendedPath('/en/work-orders', ['platform.statistics.read'], 'console')).toBe(
      false
    );
  });

  it('judges a console page by the console navigation', () => {
    expect(
      permitsIntendedPath('/en/platform/organizations', ['platform.organization.read'], 'console')
    ).toBe(true);
    expect(
      permitsIntendedPath('/en/platform/plans', ['platform.organization.read'], 'console')
    ).toBe(false);
  });

  it('refuses a path no entry contains', () => {
    expect(permitsIntendedPath('/en/not-a-screen', ['wo.work_order.read'])).toBe(false);
    expect(
      permitsIntendedPath('/en/platform/not-a-screen', ['platform.statistics.read'], 'console')
    ).toBe(false);
  });
});
