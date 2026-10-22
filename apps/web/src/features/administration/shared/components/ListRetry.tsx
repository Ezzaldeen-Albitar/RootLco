'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import Button from '@mui/material/Button';

/**
 * Try again for a list read on the server while the page was rendered — the
 * currencies, the time zones and the languages. Renders the route again, which
 * repeats the read and keeps whatever was typed (`ReferenceListRetry`'s
 * behaviour, as a Material button).
 */
export function ListRetry({ label }: { readonly label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div>
      <Button
        type="button"
        variant="outlined"
        size="small"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {label}
      </Button>
    </div>
  );
}
