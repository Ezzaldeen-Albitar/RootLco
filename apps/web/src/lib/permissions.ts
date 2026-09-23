import {
  NAVIGATION,
  navigationLinks,
  type NavigationGroup,
  type NavigationItem,
  type PermissionCode,
} from '@/config/navigation';

/**
 * Client-side permission evaluation — for USABILITY ONLY.
 *
 * ## The rule this file exists to make unavoidable
 *
 * Hiding a menu item is not access control. The server decides, every time, on
 * every request, and its denial is the only denial that means anything. What
 * this does is stop showing an operator a door they cannot open.
 *
 * Two consequences follow, and both are enforced below rather than left to
 * discipline:
 *
 *   1. **Unknown means denied.** If the actor's permission set does not contain
 *      a code, the item is hidden. Not "shown because we are not sure" — a
 *      permission set that failed to load must produce an empty sidebar, not a
 *      complete one. The failure mode of a permissive default is that a demo
 *      looks fine and production leaks a menu.
 *
 *   2. **No role shortcuts.** There is no `isAdmin`, no `role === 'owner'`, no
 *      tenant or company or branch identifier read from client state. Only the
 *      explicit permission codes the server issued, matched exactly.
 */

/** The actor's capabilities as the server issued them. */
export interface ActorCapabilities {
  /** Permission codes the server says this actor holds, in this scope. */
  readonly permissions: readonly PermissionCode[];
}

/**
 * An actor with nothing.
 *
 * The DEFAULT for any state where capabilities are unknown — loading, failed,
 * expired. Everything permission-gated disappears, which is the correct
 * appearance of "we do not know yet".
 */
export const NO_CAPABILITIES: ActorCapabilities = Object.freeze({ permissions: Object.freeze([]) });

export function hasPermission(
  capabilities: ActorCapabilities | null | undefined,
  code: PermissionCode | null
): boolean {
  // A null requirement means the item is not permission-gated at all. This is
  // deliberately NOT the same as "the actor holds everything".
  if (code === null) return true;
  if (!capabilities) return false;
  return capabilities.permissions.includes(code);
}

/** Whether an item should be visible. Children do not widen a hidden parent. */
export function isVisible(
  capabilities: ActorCapabilities | null | undefined,
  item: NavigationItem
): boolean {
  return hasPermission(capabilities, item.permission);
}

/**
 * Where a signed-in session should land: the FIRST entry of the navigation it
 * can open, in the order the sidebar draws them (Owner directive,
 * P1-32-PRE-OD-UX).
 *
 * The dashboard is that first entry, so a session holding its code lands on it
 * exactly as before. A session without it is sent to the next screen it may
 * actually use, instead of to a page that could only refuse it. "Can open" is
 * the sidebar's own rule — `visibleNavigation`, then the entries that render as
 * links (`navigationLinks`, expanded) — so the landing can never be a screen
 * the sidebar does not offer.
 *
 * Only WORKSPACE destinations count: an entry no permission gates is a
 * development tool (the design gallery, which `galleryEnabled()` answers with a
 * 404 in production), not a screen of the product, so it is never a landing —
 * a session whose codes open nothing else would otherwise be sent to a page
 * that does not exist. `null` when no workspace screen is open to the session,
 * which `landingPath` turns into the workspace root, where the dashboard page
 * states the refusal.
 *
 * The Platform Owner Console is not in this model and is not decided here: a
 * platform operator has no tenant session, and `destinationAfterSignIn` routes
 * that principal before this is ever consulted.
 */
export function landingRoute(
  capabilities: ActorCapabilities | null | undefined,
  groups: readonly NavigationGroup[] = NAVIGATION
): NavigationItem | null {
  return (
    navigationLinks(visibleNavigation(groups, capabilities), false).find(isWorkspaceDestination) ??
    null
  );
}

/**
 * Whether an entry is a screen of the workspace a session may be SENT to.
 *
 * A permission-gated entry is: the server decides every request behind it by
 * that code. An ungated one is not — the only such entry is the design gallery,
 * whose route is switched off by an environment flag and is a 404 wherever it
 * is off.
 */
export function isWorkspaceDestination(item: NavigationItem): boolean {
  return item.permission !== null;
}

/**
 * Filters the navigation model down to what this actor may see.
 *
 * A group whose every item is hidden is removed entirely — an empty group
 * heading tells the operator a module exists and they cannot have it, which is
 * both useless and a small information leak.
 */
export function visibleNavigation(
  groups: readonly NavigationGroup[],
  capabilities: ActorCapabilities | null | undefined
): readonly NavigationGroup[] {
  const filtered = groups
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => isVisible(capabilities, item))
        .map((item) =>
          item.children
            ? { ...item, children: item.children.filter((child) => isVisible(capabilities, child)) }
            : item
        ),
    }))
    .filter((group) => group.items.length > 0);
  return Object.freeze(filtered);
}
