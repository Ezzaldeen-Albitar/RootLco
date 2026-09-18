'use client';

import { usePathname } from 'next/navigation';
import { LoadingState } from '@/components/states/States';
import { localeFromPathname } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';

/**
 * Loading boundary for the Platform Owner Console route group.
 *
 * Every console page is a Server Component that awaits at least one
 * control-plane read, and each of those reads is rated `expensive-read`. Without
 * this file the whole group had no loading boundary at all: the browser held the
 * previous screen until the new one had finished rendering, with nothing said,
 * and a slow statistics read looked like a console that had stopped responding.
 *
 * The locale comes from the PATH, for the reason the workspace group records:
 * Next passes a `loading.tsx` no props, and reading `DEFAULT_LOCALE` instead
 * announces the loading state in Arabic to an English reader (P1-26-F-059).
 */
export default function PlatformLoading() {
  return <LoadingState messages={getMessages(localeFromPathname(usePathname()))} />;
}
