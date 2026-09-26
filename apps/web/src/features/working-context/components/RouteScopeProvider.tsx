'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { routeBranchScopeFor, type RouteBranchScope } from '@/config/route-branch-scope';

const RouteScopeValue = createContext<RouteBranchScope | null>(null);

/**
 * The branch posture of the route being shown, for everything inside the
 * workspace shell (`config/route-branch-scope.ts`).
 *
 * Read once here from the address — on the server render as well as in the
 * browser — and handed down, so `ConcreteRouteGate` inside each page body can
 * decide without reading the router itself. The dashboard layout renders it
 * around the shell; outside it (a screen rendered on its own) the posture is
 * `null` and nothing is gated, and `tests/route-branch-scope.test.ts` holds the
 * layout to rendering it.
 */
export function RouteScopeProvider({ children }: { readonly children: ReactNode }) {
  const scope = routeBranchScopeFor(usePathname() ?? '');
  return <RouteScopeValue.Provider value={scope}>{children}</RouteScopeValue.Provider>;
}

/** The posture of the route being shown, or `null` outside the workspace shell. */
export function useRouteScope(): RouteBranchScope | null {
  return useContext(RouteScopeValue);
}
