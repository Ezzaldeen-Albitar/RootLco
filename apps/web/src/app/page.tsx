import { redirect } from 'next/navigation';
import { DEFAULT_LOCALE } from '@/i18n/config';

export default function Root() {
  redirect(`/${DEFAULT_LOCALE}`);
}
