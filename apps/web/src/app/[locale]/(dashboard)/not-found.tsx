'use client';

import { usePathname } from 'next/navigation';
import { NotFoundState } from '@/components/states/States';
import { localeFromPathname } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';

/**
 * Route-group not-found boundary. Renders inside the shell, not bare.
 *
 * The locale comes from the PATH. Next gives a not-found boundary no `params`,
 * so reading `DEFAULT_LOCALE` was the obvious thing to do — and it produced an
 * English page inside a `lang="ar" dir="rtl"` document, which is the same defect
 * class as `P1-26-F-059`. `loading.tsx` was corrected for it; this file and
 * `error.tsx` were not (`P1-26-F-071`).
 *
 * It became a client component in order to read the pathname. That is the trade
 * `loading.tsx` already makes and it costs nothing here: this screen has no data
 * and no server work — one illustration and one sentence.
 */
export default function DashboardNotFound() {
  return <NotFoundState messages={getMessages(localeFromPathname(usePathname()))} />;
}
