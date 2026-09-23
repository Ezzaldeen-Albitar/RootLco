import { hrefFor } from '@/config/navigation';
import type { Locale } from '@/i18n/config';
import { landingRoute } from '@/lib/permissions';

/**
 * The address a signed-in tenant session should land on (Owner directive,
 * P1-32-PRE-OD-UX).
 *
 * The first entry of the navigation the session's codes open — the dashboard
 * for anyone holding `wo.work_order.read`, and otherwise the next screen they
 * can actually use — so nobody signs in to a page that can only refuse them.
 * The rule itself is `landingRoute`; this only turns it into an address, in one
 * place, for the two callers that decide a landing: the sign-in redirect and the
 * dashboard page.
 *
 * The workspace root when the navigation offers nothing at all, which leaves the
 * dashboard page to state the refusal.
 */
export function landingPath(locale: Locale, permissions: readonly string[]): string {
  const route = landingRoute({ permissions });
  return route === null ? `/${locale}` : hrefFor(locale, route);
}
