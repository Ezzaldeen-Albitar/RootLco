import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
import { renderLtr, renderRtl } from './render';
import { EN, ITEM_ID, USER_ID, item, itemPage, labelled, okRead } from './support/stock-operations';

/**
 * Labels and the scan box, rendered (P1-32).
 *
 * The properties under test, each of which is a way this screen can be wrong
 * while every other check is green:
 *
 *  - **A wedge scan is an Enter-terminated typed code.** The box has to accept
 *    exactly that, and a person typing the same characters has to be treated
 *    identically.
 *  - **A doubled frame is ignored, and SAID to be ignored.** One physical scan
 *    delivered twice must resolve once; a silently dropped scan is
 *    indistinguishable from a broken scanner.
 *  - **No camera is not an error.** When the browser publishes no barcode
 *    detector — which is every browser under this suite — the box says so and
 *    manual entry is untouched.
 *  - **The label carries readable text and the bars are drawn.** A label a
 *    scanner cannot read and a person cannot read either is the failure worth
 *    testing, so both the drawing and the human-readable line are asserted.
 *  - **A bad check digit is refused rather than drawn.** Bars that scan back as
 *    a different number are worse than no bars.
 */

const AR = ar as Record<string, string>;

const readItemLabel = vi.fn();
const resolveBarcode = vi.fn();
const listItems = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  readItemLabel: (...args: unknown[]) => readItemLabel(...args),
  resolveBarcode: (...args: unknown[]) => resolveBarcode(...args),
  listItems: (...args: unknown[]) => listItems(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({
    userId: USER_ID,
    permissions: PERMISSIONS,
    email: 'operator@test.local',
  }),
}));

const { LabelsScreen } = await import('@/features/inventory/components/LabelsScreen');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const LabelsPage = (await import('@/app/[locale]/(dashboard)/inventory/labels/page'))
  .default as unknown as RoutePage;

/** A real EAN-13: 4006381333931. Its last digit is the one the rest implies. */
const GOOD_EAN = '4006381333931';
/** The same code with the last digit changed, which no scanner would read back. */
const BAD_EAN = '4006381333930';

function label(over: Record<string, unknown> = {}) {
  return {
    itemId: ITEM_ID,
    sku: 'BRK-001',
    name: 'Brake pad',
    primaryBarcode: {
      identifierId: 'id-1',
      kind: 'ean',
      value: GOOD_EAN,
      normalizedValue: GOOD_EAN,
      symbology: 'ean13',
    },
    unit: { id: 'u', code: 'EA' },
    packQuantity: '1.000',
    ...over,
  };
}

function resolution(over: Record<string, unknown> = {}) {
  return {
    scannedValue: GOOD_EAN,
    normalizedValue: GOOD_EAN,
    item: {
      id: ITEM_ID,
      sku: 'BRK-001',
      name: 'Brake pad',
      isSerialized: false,
      isStockTracked: true,
      lifecycleStatus: 'active',
    },
    identifier: { id: 'id-1', kind: 'ean', isPrimary: true, symbology: 'ean13' },
    unit: { id: 'u', code: 'EA' },
    packQuantity: '1.000',
    availability: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = ['inv.item.read'];
  readItemLabel.mockResolvedValue(okRead(label()));
  resolveBarcode.mockResolvedValue(okRead(resolution()));
  listItems.mockResolvedValue(itemPage([item]));
});

/** Type a code into the scan box and end it with Enter, exactly as a wedge does. */
async function wedge(user: ReturnType<typeof userEvent.setup>, code: string) {
  const box = screen.getByLabelText(labelled('inventory.scan.label'));
  await user.click(box);
  await user.keyboard(`${code}{Enter}`);
}

describe('the scan box', () => {
  it('accepts a wedge scan: typed characters ended with Enter', async () => {
    const user = userEvent.setup();
    renderLtr(<LabelsScreen locale="en" messages={en} />);
    await wedge(user, GOOD_EAN);
    await waitFor(() => expect(resolveBarcode).toHaveBeenCalledTimes(1));
    expect(resolveBarcode.mock.calls[0]?.[0]).toBe(GOOD_EAN);
  });

  it('treats a typed code and a button press the same way as a wedge scan', async () => {
    const user = userEvent.setup();
    renderLtr(<LabelsScreen locale="en" messages={en} />);
    await user.type(screen.getByLabelText(labelled('inventory.scan.label')), GOOD_EAN);
    await user.click(screen.getByRole('button', { name: EN['inventory.scan.submit'] as string }));
    await waitFor(() => expect(resolveBarcode).toHaveBeenCalledTimes(1));
  });

  it('IGNORES the same code arriving twice in a moment, and says it did', async () => {
    const user = userEvent.setup();
    renderLtr(<LabelsScreen locale="en" messages={en} />);
    await wedge(user, GOOD_EAN);
    await waitFor(() => expect(resolveBarcode).toHaveBeenCalledTimes(1));
    await wedge(user, GOOD_EAN);
    // The second frame resolved nothing...
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.scan.repeatIgnored'] as string)).toBeTruthy()
    );
    expect(resolveBarcode).toHaveBeenCalledTimes(1);
  });

  it('does not ignore a DIFFERENT code that follows immediately', async () => {
    const user = userEvent.setup();
    renderLtr(<LabelsScreen locale="en" messages={en} />);
    await wedge(user, GOOD_EAN);
    await waitFor(() => expect(resolveBarcode).toHaveBeenCalledTimes(1));
    await wedge(user, '9638507');
    await waitFor(() => expect(resolveBarcode).toHaveBeenCalledTimes(2));
  });

  it('says the camera is unavailable and leaves manual entry in place', () => {
    // jsdom publishes no barcode detector, which is the branch an operator on an
    // ordinary desktop browser meets.
    renderLtr(<LabelsScreen locale="en" messages={en} />);
    expect(screen.getByText(EN['inventory.scan.camera.unsupported'] as string)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: EN['inventory.scan.camera.start'] as string })
    ).toBeNull();
    expect(screen.getByLabelText(labelled('inventory.scan.label'))).toBeTruthy();
  });

  it('offers the camera when the browser publishes a barcode detector', () => {
    const detector = vi.fn();
    (window as unknown as Record<string, unknown>)['BarcodeDetector'] = detector;
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn() },
      configurable: true,
    });
    try {
      renderLtr(<LabelsScreen locale="en" messages={en} />);
      expect(
        screen.getByRole('button', { name: EN['inventory.scan.camera.start'] as string })
      ).toBeTruthy();
      expect(screen.queryByText(EN['inventory.scan.camera.unsupported'] as string)).toBeNull();
    } finally {
      delete (window as unknown as Record<string, unknown>)['BarcodeDetector'];
    }
  });

  it('says a scanned code that no item carries is not carried by any item', async () => {
    const user = userEvent.setup();
    resolveBarcode.mockResolvedValue({ status: 'not-found', correlationId: 'corr' });
    renderLtr(<LabelsScreen locale="en" messages={en} />);
    await wedge(user, GOOD_EAN);
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.scan.notFound'] as string)).toBeTruthy()
    );
  });

  it('says a code carried by two items is not resolved to either', async () => {
    const user = userEvent.setup();
    resolveBarcode.mockResolvedValue({ status: 'error', correlationId: 'corr' });
    renderLtr(<LabelsScreen locale="en" messages={en} />);
    await wedge(user, GOOD_EAN);
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.scan.ambiguous'] as string)).toBeTruthy()
    );
  });
});

describe('the printed label', () => {
  it('draws bars and prints the code, the name and the stock code under them', async () => {
    const user = userEvent.setup();
    const { container } = renderLtr(<LabelsScreen locale="en" messages={en} />);
    await wedge(user, GOOD_EAN);
    await waitFor(() => expect(readItemLabel).toHaveBeenCalledWith(ITEM_ID));

    const drawing = await screen.findByRole('img', {
      name: `${EN['inventory.labels.barcodeLabel'] as string} ${GOOD_EAN}`,
    });
    // Real bars, not a placeholder: an EAN-13 symbol is thirty black runs.
    expect(drawing.querySelectorAll('rect').length).toBe(30);
    // And the number is text a person can read, not painted into the drawing.
    expect(within(container).getAllByText(GOOD_EAN).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Brake pad').length).toBeGreaterThan(0);
    expect(screen.getAllByText('BRK-001').length).toBeGreaterThan(0);
  });

  it('REFUSES to draw a code whose last digit does not match, and prints the number', async () => {
    const user = userEvent.setup();
    readItemLabel.mockResolvedValue(
      okRead(
        label({
          primaryBarcode: {
            identifierId: 'id-1',
            kind: 'ean',
            value: BAD_EAN,
            normalizedValue: BAD_EAN,
            symbology: 'ean13',
          },
        })
      )
    );
    renderLtr(<LabelsScreen locale="en" messages={en} />);
    await wedge(user, GOOD_EAN);
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.labels.refusal.checkDigit'] as string)).toBeTruthy()
    );
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getAllByText(BAD_EAN).length).toBeGreaterThan(0);
  });

  it('prints one label per copy asked for', async () => {
    const user = userEvent.setup();
    renderLtr(<LabelsScreen locale="en" messages={en} />);
    await wedge(user, GOOD_EAN);
    await screen.findByRole('img');
    const copies = screen.getByLabelText(labelled('inventory.labels.format.copies'));
    await user.clear(copies);
    await user.type(copies, '3');
    await waitFor(() => expect(screen.getAllByRole('img').length).toBe(3));
  });

  it('refuses a copies box that is not a whole number in range', async () => {
    const user = userEvent.setup();
    const print = vi.fn();
    Object.defineProperty(window, 'print', { value: print, configurable: true });
    renderLtr(<LabelsScreen locale="en" messages={en} />);
    await wedge(user, GOOD_EAN);
    await screen.findByRole('img');
    const copies = screen.getByLabelText(labelled('inventory.labels.format.copies'));
    await user.clear(copies);
    await user.type(copies, '999');
    await user.click(screen.getByRole('button', { name: EN['inventory.labels.print'] as string }));
    expect(screen.getByText(EN['inventory.labels.format.copiesRange'] as string)).toBeTruthy();
    expect(print).not.toHaveBeenCalled();
  });

  it('carries the label size on the sheet so the print stylesheet can size it', async () => {
    const user = userEvent.setup();
    const { container } = renderLtr(<LabelsScreen locale="en" messages={en} />);
    await wedge(user, GOOD_EAN);
    await screen.findByRole('img');
    expect(container.querySelector('[data-label-sheet="50x25"]')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText(labelled('inventory.labels.format.size')), 'a4');
    await waitFor(() => expect(container.querySelector('[data-label-sheet="a4"]')).toBeTruthy());
  });

  it('says an item carrying no code has nothing to print, rather than printing a blank', async () => {
    const user = userEvent.setup();
    readItemLabel.mockResolvedValue(okRead(label({ primaryBarcode: null })));
    renderLtr(<LabelsScreen locale="en" messages={en} />);
    await wedge(user, GOOD_EAN);
    await waitFor(() =>
      expect(screen.getByText(EN['inventory.labels.noCode'] as string)).toBeTruthy()
    );
  });

  it('states that a label carries no price, and why', async () => {
    const user = userEvent.setup();
    renderLtr(<LabelsScreen locale="en" messages={en} />);
    await wedge(user, GOOD_EAN);
    await screen.findByRole('img');
    expect(screen.getByText(EN['inventory.labels.noPriceNote'] as string)).toBeTruthy();
  });
});

describe('the route page', () => {
  it('denies without the catalogue permission and renders no screen', async () => {
    PERMISSIONS = [];
    renderLtr(
      (await LabelsPage({ params: Promise.resolve({ locale: 'en' }) })) as React.ReactElement
    );
    expect(screen.queryByLabelText(labelled('inventory.scan.label'))).toBeNull();
    expect(readItemLabel).not.toHaveBeenCalled();
  });

  it('renders the screen for a holder of the catalogue permission', async () => {
    PERMISSIONS = ['inv.item.read'];
    renderLtr(
      (await LabelsPage({ params: Promise.resolve({ locale: 'en' }) })) as React.ReactElement
    );
    expect(screen.getByLabelText(labelled('inventory.scan.label'))).toBeTruthy();
  });
});

describe('Arabic', () => {
  it('renders the label screen right to left with its own words', () => {
    renderRtl(<LabelsScreen locale="ar" messages={ar} />);
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText(AR['inventory.labels.explain'] as string)).toBeTruthy();
  });
});
