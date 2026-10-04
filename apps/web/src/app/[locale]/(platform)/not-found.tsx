'use client';

import { usePathname } from 'next/navigation';
import { NotFoundState } from '@/components/states/States';
import { localeFromPathname } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';

/**
 * Not-found boundary for the Platform Owner Console route group.
 *
 * The console layout and every console page call `notFound()` for an address
 * whose language segment is not one this product speaks. With no boundary here
 * that call left the console shell behind; now it renders inside it, so the
 * operator keeps the navigation and can go back to a screen that exists.
 *
 * The locale comes from the PATH, for the reason `error.tsx` beside it records.
 */
export default function PlatformNotFound() {
  return <NotFoundState messages={getMessages(localeFromPathname(usePathname()))} />;
}
