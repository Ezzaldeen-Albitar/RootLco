import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { MuiEmptyState } from '@/components/states/MuiStates';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import type { ReferenceValues } from '../types';
import { OrgReadFailure } from './OrgReadFailure';

type Currency = ReferenceValues['currencies'][number];

/**
 * The currencies the platform holds, as `org.reference-values-read` publishes
 * them (P1-32-PRE-OD-ADM5).
 *
 * Exactly the rows the read answered, in the order it answered them — the
 * ACTIVE rows of `shared.currencies`, in code order. Nothing is added, hidden or
 * defaulted here: which currencies the platform holds is the Owner's decision
 * (OIR-04), not this screen's.
 *
 * The name is said in the page's language. The register publishes one name per
 * currency, so the reader's language comes from the ISO 4217 code through the
 * runtime's own currency names; where the runtime has none, the registered name
 * is shown as published. The decimal places are the register's `minor_unit`,
 * shown as the whole number it is — nothing is computed from it here.
 *
 * Rendered on the server (no client directive): the names are decided once,
 * with the page, and a read that did not answer is the shared Material state,
 * whose Try again renders the route again.
 */
export function CurrencyCatalogue({
  messages,
  locale,
  read,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly read: ReadState<readonly Currency[]>;
}) {
  const t = (key: string) => translate(messages, key as keyof Messages);

  if (read.status !== 'ok') {
    return (
      <OrgReadFailure
        messages={messages}
        locale={locale}
        status={read.status}
        correlationId={read.correlationId}
        testId="currency-catalogue-failure"
      />
    );
  }

  if (read.data.length === 0) {
    return (
      <MuiEmptyState
        messages={messages}
        titleKey="currencies.catalogue.empty.title"
        descriptionKey="currencies.catalogue.empty.description"
        testId="currency-catalogue-empty"
      />
    );
  }

  const names = displayNames(locale);
  return (
    <TableContainer className="rounded-xl border border-border-subtle">
      <Table size="small" aria-label={t('currencies.catalogue.title')}>
        <TableHead>
          <TableRow>
            <TableCell>{t('currencies.catalogue.code')}</TableCell>
            <TableCell>{t('currencies.catalogue.name')}</TableCell>
            <TableCell className="text-end">{t('currencies.catalogue.minorUnit')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {read.data.map((currency) => (
            <TableRow key={currency.code} data-testid="currency-row">
              <TableCell className="font-mono text-caption">
                <span dir="ltr">{currency.code}</span>
              </TableCell>
              <TableCell>{nameOf(names, currency)}</TableCell>
              <TableCell className="text-end tabular-nums">{String(currency.minorUnit)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** The runtime's currency names in the page's language, or none where it has none. */
function displayNames(locale: Locale): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([locale], { type: 'currency', fallback: 'none' });
  } catch {
    return null;
  }
}

function nameOf(names: Intl.DisplayNames | null, currency: Currency): string {
  try {
    return names?.of(currency.code) ?? currency.name;
  } catch {
    // A code the runtime refuses to look up is still the register's row.
    return currency.name;
  }
}
