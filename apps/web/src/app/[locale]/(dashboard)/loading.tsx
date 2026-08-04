'use client';

import { usePathname } from 'next/navigation';

import { LoadingState } from '@/components/states/States';
import { localeFromPathname } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';

/**
 * Route-group loading boundary.
 *
 * Next passes a `loading.tsx` no props — not even params — so the route's
 * locale has to come from the URL. This was previously DEFAULT_LOCALE, which
 * is Arabic, so the English interface announced "جارٍ التحميل" to screen
 * readers on every navigation (P1-26-F-059). It is `sr-only` text inside a
 * skeleton that resolves in under a second, which is why every automated tier
 * looked straight past it.
 *
 * A client component is the cost of reading the URL here. It ships no context
 * and no data — `usePathname` is synchronous, and the fallback still renders
 * immediately.
 */
export default function DashboardLoading() {
  return <LoadingState messages={getMessages(localeFromPathname(usePathname()))} />;
}
