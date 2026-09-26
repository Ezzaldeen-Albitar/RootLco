'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { flattenNavigation, type NavigationItem } from '@/config/navigation';
import { routeBranchScopeFor, type RouteBranchScope } from '@/config/route-branch-scope';
import { isLocale } from '@/i18n/config';
import { isVisible } from '@/lib/permissions';

/** The route being shown: its branch posture, and whether the operator may open it. */
export interface RouteScope {
  readonly scope: RouteBranchScope;
  /**
   * False when the session lacks the permission the navigation map requires
   * for this route. A refusal comes before any branch ask (PR #467 review).
   */
  readonly permitted: boolean;
}

const RouteScopeValue = createContext<RouteScope | null>(null);

function segmentsOf(pathname: string): string[] {
  const segments = (pathname.split(/[?#]/)[0] ?? '').split('/').filter(Boolean);
  return segments.length > 0 && isLocale(segments[0] as string) ? segments.slice(1) : segments;
}

/**
 * The navigation entry that governs an address: the one whose route is the
 * longest leading run of the address's segments. `/receptions/check-in` falls
 * under `/receptions`; the dashboard root governs only itself. `null` when no
 * entry governs the address.
 */
export function navigationRequirementFor(pathname: string): NavigationItem | null {
  const address = segmentsOf(pathname);
  let best: { item: NavigationItem; length: number } | null = null;
  for (const item of flattenNavigation()) {
    if (item.status !== 'available') continue;
    const route = segmentsOf(item.href);
    if (route.length === 0 && address.length !== 0) continue;
    if (route.length > address.length) continue;
    if (!route.every((segment, index) => address[index] === segment)) continue;
    if (best === null || route.length > best.length) best = { item, length: route.length };
  }
  return best?.item ?? null;
}

/**
 * The posture of the route being shown, for everything inside the workspace
 * shell (`config/route-branch-scope.ts`), and whether the session may open it.
 *
 * Read once here from the address — on the server render as well as in the
 * browser — and handed down, so `ConcreteRouteGate` inside each page body can
 * decide without reading the router itself. `permitted` is decided from the
 * SAME map the navigation filters on (`config/navigation.ts`, `isVisible`) and
 * the session's permissions, so an operator who may not open the route sees the
 * page's refusal rather than a branch ask, however deep in the page that refusal
 * is drawn. The dashboard layout renders this around the shell; outside it (a
 * screen rendered on its own) there is no posture and nothing is gated, and
 * `tests/route-branch-scope.test.ts` holds the layout to rendering it.
 */
export function RouteScopeProvider({
  permissions,
  children,
}: {
  /** The session's permission codes. Without them, nothing is taken as refused. */
  readonly permissions?: readonly string[] | undefined;
  readonly children: ReactNode;
}) {
  const pathname = usePathname() ?? '';
  const requirement = navigationRequirementFor(pathname);
  const value: RouteScope = {
    scope: routeBranchScopeFor(pathname),
    permitted:
      permissions === undefined || requirement === null || isVisible({ permissions }, requirement),
  };
  return <RouteScopeValue.Provider value={value}>{children}</RouteScopeValue.Provider>;
}

/** The route being shown, or `null` outside the workspace shell. */
export function useRouteScope(): RouteScope | null {
  return useContext(RouteScopeValue);
}
