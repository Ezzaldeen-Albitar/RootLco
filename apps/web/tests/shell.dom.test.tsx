import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { DataTable, type Column, type TableStatus } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { MoneyField } from '@/components/forms/MoneyField';
import { TextField } from '@/components/forms/Field';
import { PageHeader } from '@/components/shell/PageHeader';
import { LocaleSwitcher, swapLocale } from '@/components/shell/LocaleSwitcher';
import { Sidebar } from '@/components/shell/Sidebar';
import { NAVIGATION } from '@/config/navigation';
import { getMessages } from '@/i18n/get-messages';
import { visibleNavigation } from '@/lib/permissions';
import { BOTH_DIRECTIONS, renderLtr, renderRtl } from './render';

// `useSearchParams` joined the mock when the locale switcher began preserving
// safe query parameters. An empty instance is the honest default: these cases
// assert the SWAP, and the carrying rule has its own tests below.
vi.mock('next/navigation', () => ({
  usePathname: () => '/en',
  useSearchParams: () => new URLSearchParams(''),
}));

const messages = getMessages('en');
const arabic = getMessages('ar');

const FULL = { permissions: NAVIGATION.flatMap((g) => g.items.map((i) => i.permission ?? 'x')) };

describe('sidebar', () => {
  const groups = visibleNavigation(NAVIGATION, FULL);

  it('is a navigation landmark with an accessible name', () => {
    renderLtr(
      <Sidebar locale="en" messages={messages} groups={groups} pathname="/en" collapsed={false} />
    );
    expect(screen.getByRole('navigation', { name: 'Modules' })).toBeInTheDocument();
  });

  it('marks the current route with aria-current', () => {
    renderLtr(
      <Sidebar locale="en" messages={messages} groups={groups} pathname="/en" collapsed={false} />
    );
    const overview = screen.getByRole('link', { name: 'Overview' });
    expect(overview).toHaveAttribute('aria-current', 'page');
  });

  it('renders a planned module as NOT a link', () => {
    // An operator who clicks a module and lands on a 404 stops trusting the
    // whole navigation.
    renderLtr(
      <Sidebar locale="en" messages={messages} groups={groups} pathname="/en" collapsed={false} />
    );
    expect(screen.queryByRole('link', { name: /Customers/ })).toBeNull();
    const planned = screen.getByText('Customers', { selector: 'span' });
    expect(planned.closest('[aria-disabled="true"]')).not.toBeNull();
  });

  it('keeps the accessible name when collapsed', async () => {
    const { rerender } = renderLtr(
      <Sidebar locale="en" messages={messages} groups={groups} pathname="/en" collapsed={false} />
    );
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    rerender(<Sidebar locale="en" messages={messages} groups={groups} pathname="/en" collapsed />);
    // Collapsing is a VISUAL affordance; it must not change what a screen
    // reader announces.
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
  });

  it('shows only what the actor may see', () => {
    const groupsForNobody = visibleNavigation(NAVIGATION, { permissions: [] });
    renderLtr(
      <Sidebar
        locale="en"
        messages={messages}
        groups={groupsForNobody}
        pathname="/en"
        collapsed={false}
      />
    );
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.queryByText('Billing')).toBeNull();
  });

  it('renders in Arabic under RTL', () => {
    renderRtl(
      <Sidebar locale="ar" messages={arabic} groups={groups} pathname="/ar" collapsed={false} />
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('navigation', { name: 'الوحدات' })).toBeInTheDocument();
  });
});

describe('page header', () => {
  it('renders exactly one h1', () => {
    renderLtr(
      <PageHeader
        locale="en"
        messages={messages}
        titleKey="overview.title"
        descriptionKey="overview.description"
        crumbs={[{ labelKey: 'nav.overview', href: '/en' }, { labelKey: 'nav.gallery' }]}
      />
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('marks the last breadcrumb as the current page and does not link it', () => {
    renderLtr(
      <PageHeader
        locale="en"
        messages={messages}
        titleKey="gallery.title"
        crumbs={[{ labelKey: 'nav.overview', href: '/en' }, { labelKey: 'nav.gallery' }]}
      />
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByText('Component gallery')).toHaveAttribute('aria-current', 'page');
    expect(within(nav).queryByRole('link', { name: 'Component gallery' })).toBeNull();
  });
});

describe('locale switcher', () => {
  it('swaps only the locale segment', () => {
    expect(swapLocale('/en/gallery', 'ar')).toBe('/ar/gallery');
    expect(swapLocale('/ar', 'en')).toBe('/en');
    expect(swapLocale('/en/work-orders/diagnostics', 'ar')).toBe('/ar/work-orders/diagnostics');
  });

  it('prefixes a path that carries no locale rather than overwriting a segment', () => {
    expect(swapLocale('/gallery', 'ar')).toBe('/ar/gallery');
    expect(swapLocale('/', 'en')).toBe('/en');
  });

  it('renders real links, so direction is set by the server on the next document', () => {
    renderLtr(<LocaleSwitcher locale="en" messages={messages} />);
    const arabicLink = screen.getByRole('link', { name: 'العربية' });
    expect(arabicLink).toHaveAttribute('href', '/ar');
    expect(arabicLink).toHaveAttribute('hreflang', 'ar');
  });
});

interface Row {
  readonly id: string;
  readonly reference: string;
  readonly amount: string;
}

const ROWS: Row[] = [
  { id: '1', reference: 'DOC-000001', amount: '10.0000' },
  { id: '2', reference: 'DOC-000002', amount: '20.0000' },
];

const COLUMNS: readonly Column<Row>[] = [
  { id: 'reference', headerKey: 'column.reference', sortable: true, cell: (r) => r.reference },
  { id: 'amount', headerKey: 'column.amount', numeric: true, cell: (r) => r.amount },
];

function TableHost({ status = 'idle' }: { readonly status?: TableStatus }) {
  const [request, setRequest] = useState<TableRequest>(INITIAL_REQUEST);
  return (
    <DataTable
      messages={messages}
      columns={COLUMNS}
      rowId={(row) => row.id}
      request={request}
      response={{ rows: ROWS, total: 42, page: request.page, pageSize: request.pageSize }}
      status={status}
      onRequestChange={setRequest}
      caption="Fixtures"
    />
  );
}

describe('data table', () => {
  it('announces the sort state on the header, not only with an arrow', async () => {
    const user = userEvent.setup();
    renderLtr(<TableHost />);
    const header = screen.getByRole('columnheader', { name: /Reference/ });
    expect(header).toHaveAttribute('aria-sort', 'none');
    await user.click(within(header).getByRole('button'));
    expect(screen.getByRole('columnheader', { name: /Reference/ })).toHaveAttribute(
      'aria-sort',
      'ascending'
    );
  });

  it('gives pagination controls word names, not glyph names', () => {
    renderLtr(<TableHost />);
    // "«" is announced as "left-pointing double angle quotation mark", which is
    // both wrong and direction-dependent.
    for (const name of ['First page', 'Previous page', 'Next page', 'Last page']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('announces the visible range politely', () => {
    renderLtr(<TableHost />);
    const status = screen.getByText(/Showing/);
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('1–25');
    expect(status).toHaveTextContent('42');
  });

  it('disables paging backwards on the first page', () => {
    renderLtr(<TableHost />);
    expect(screen.getByRole('button', { name: 'First page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('marks the body busy while loading', () => {
    renderLtr(<TableHost status="loading" />);
    // aria-busy on the body, so assistive technology knows the rows are being
    // replaced rather than reading a half-updated table.
    const [, body] = screen.getAllByRole('rowgroup');
    expect(body).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('DOC-000001')).toBeNull();
  });

  it('renders the denied state INSTEAD of the rows', () => {
    renderLtr(<TableHost status="denied" />);
    // A denied table that paints its rows and covers them has already sent the
    // data to the browser.
    expect(screen.queryByText('DOC-000001')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('You do not have access');
  });

  it('has no axe violations in either direction', async () => {
    for (const [, renderIn] of BOTH_DIRECTIONS) {
      const { container, unmount } = renderIn(<TableHost />);
      const results = await axe(container);
      expect(results.violations).toEqual([]);
      unmount();
    }
  });
});

describe('form controls', () => {
  it('associates label, description and error with the control', () => {
    renderLtr(
      <TextField
        label="Name"
        description="A short label"
        error="This field is required."
        required
      />
    );
    const input = screen.getByLabelText(/Name/);
    expect(input).toHaveAccessibleDescription(/A short label/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('This field is required.');
  });

  it('keeps a money amount as a string and canonicalises on blur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderLtr(
      <MoneyField messages={messages} label="Amount" currency="JOD" value="" onChange={onChange} />
    );
    const input = screen.getByLabelText(/Amount/);
    await user.type(input, '12.5');
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith('12.5000', true);
    expect(input).toHaveValue('12.5000');
  });

  it('is a text input, not a number input', () => {
    // A number input silently accepts exponent notation, drops leading zeros and
    // hands back a value the browser already coerced.
    renderLtr(
      <MoneyField messages={messages} label="Amount" currency="JOD" value="" onChange={vi.fn()} />
    );
    const input = screen.getByLabelText(/Amount/);
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(input).toHaveAttribute('dir', 'ltr');
  });

  it('reports an invalid amount rather than coercing it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderLtr(
      <MoneyField messages={messages} label="Amount" currency="JOD" value="" onChange={onChange} />
    );
    await user.type(screen.getByLabelText(/Amount/), '12.00001');
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith('12.00001', false);
    expect(screen.getByRole('alert')).toHaveTextContent('At most four decimal places.');
  });

  it('has no axe violations in either direction', async () => {
    for (const [, renderIn] of BOTH_DIRECTIONS) {
      const { container, unmount } = renderIn(
        <TextField label="Name" description="A short label" required />
      );
      const results = await axe(container);
      expect(results.violations).toEqual([]);
      unmount();
    }
  });
});
