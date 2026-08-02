import type { NavigationGroup, NavigationItem, PermissionCode } from '@/config/navigation';

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
