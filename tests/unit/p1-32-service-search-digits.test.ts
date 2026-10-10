import { describe, expect, it, vi } from 'vitest';

/**
 * The service catalogue search folds Arabic-Indic digits on the server
 * (Owner directive: unified server-side search; the services and pricing
 * Material UI slice, review round 2).
 *
 * The catalogue's search box tells the operator "Digits read as OIL-3" when
 * `OIL-٣` is typed, because the server is meant to fold the digits itself. The
 * `svc.service-list` read used to match the raw term, so that sentence was
 * false and the search found nothing. It now folds BOTH sides of the
 * comparison: the term in the application with `foldDigits`, each column in
 * SQL with its twin `shared.fold_digits`.
 *
 * The database is a stand-in here, so what is observed is exactly the
 * statement and the values the read hands to PostgreSQL. The behaviour against
 * a real database is exercised by `tests/backend/p1-20-service-catalog.test.ts`.
 */

const { ServiceCatalogRepository } =
  await import('@api/modules/service-catalog/data/service-catalog-repository');

function standIn() {
  const query = vi.fn(async (_text: string, _values: readonly unknown[]) => ({ rows: [] }));
  const db = {
    context: {
      principal: {
        tenantId: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
      },
    },
    query,
  };
  return { db: db as never, query };
}

async function searchFor(term: string) {
  const { db, query } = standIn();
  await new ServiceCatalogRepository().listServices(
    db,
    { search: term },
    { limit: 25, cursor: null }
  );
  expect(query).toHaveBeenCalledTimes(1);
  const [text, values] = query.mock.calls[0] as [string, readonly unknown[]];
  return { text, values };
}

describe('svc.service-list folds digits on both sides of the search', () => {
  it('a term typed with Arabic-Indic or Eastern Arabic-Indic digits is sent in ASCII', async () => {
    expect((await searchFor('OIL-٣')).values).toContain('OIL-3%');
    expect((await searchFor('OIL-۳')).values).toContain('OIL-3%');
    expect((await searchFor('OIL-3')).values).toContain('OIL-3%');
  });

  it('the fold leaves the escaping of LIKE metacharacters intact', async () => {
    expect((await searchFor('١%_')).values).toContain('1\\%\\_%');
  });

  it('each column is folded by the SQL twin, so a stored Arabic-Indic digit meets an ASCII one', async () => {
    const { text } = await searchFor('OIL-3');
    const compact = text.replace(/\s+/g, ' ');
    expect(compact).toContain('shared.fold_digits(s.service_code) ILIKE $2');
    expect(compact).toContain('shared.fold_digits(s.name) ILIKE $2');
  });
});
