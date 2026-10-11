import { join } from 'node:path';
import postcss, { type AtRule } from 'postcss';
import * as sass from 'sass';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
import type { ReactElement } from 'react';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { messagesFor, renderLtr as renderBareLtr, renderRtl as renderBareRtl } from './render';
import {
  EN,
  ITEM_ID,
  USER_ID,
  item,
  itemPage,
  labelled,
  okRead,
  seriousViolations,
} from './support/stock-operations';

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

/*
 * Since `P1-32-PRE-OD-INV6` every render goes under the product's Material
 * provider, as the locale layout mounts it: the scan box, the size and copies
 * fields and the buttons are Material's. No selector of an existing case moved.
 */
function withMui(ui: ReactElement, locale: 'en' | 'ar'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(messagesFor(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}
const renderLtr = (ui: ReactElement) => renderBareLtr(withMui(ui, 'en'));
const renderRtl = (ui: ReactElement) => renderBareRtl(withMui(ui, 'ar'));

const readItemLabel = vi.fn();
const resolveBarcode = vi.fn();
const listItems = vi.fn();
// P1-32-PRE-OD-INVF: units named through the list (UNIT-names).
const listUnitsOfMeasure = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  listUnitsOfMeasure: (...args: unknown[]) => listUnitsOfMeasure(...args),
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
  // P1-32-PRE-OD-INVF: the screen names a unit by code through the unit list.
  listUnitsOfMeasure.mockResolvedValue({
    status: 'ok',
    data: { items: [] },
    correlationId: 'corr',
  });
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

/*
 * P1-32-PRE-OD-INV6: labels and the scan box on Material UI. What the move must
 * keep, in both languages: a wedge scan is an Enter-terminated typed code in a
 * box read left to right; the copies box is a whole-number box whose refusal is
 * marked on it with what was typed kept; a label that could not be read is said
 * as what happened, in the screen's own sentence, with a retry only where
 * retrying can change the answer.
 */
describe('on Material UI (INV6)', () => {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const catalogueOf = (locale: 'en' | 'ar') => (locale === 'ar' ? AR : EN);
  const namedIn = (catalogue: Record<string, string>) => (key: string) =>
    new RegExp(`^${escape(catalogue[key] as string)}`);
  function renderIn(locale: 'en' | 'ar') {
    return locale === 'ar'
      ? renderRtl(<LabelsScreen locale="ar" messages={ar} />)
      : renderLtr(<LabelsScreen locale="en" messages={en} />);
  }
  async function wedgeIn(
    user: ReturnType<typeof userEvent.setup>,
    catalogue: Record<string, string>,
    code: string
  ) {
    const box = screen.getByLabelText(namedIn(catalogue)('inventory.scan.label'));
    await user.click(box);
    await user.keyboard(`${code}{Enter}`);
    return box;
  }

  for (const locale of ['en', 'ar'] as const) {
    it(`a wedge scan is read left to right and resolved once (${locale})`, async () => {
      const catalogue = catalogueOf(locale);
      const user = userEvent.setup();
      renderIn(locale);
      const box = await wedgeIn(user, catalogue, GOOD_EAN);
      expect(box).toHaveAttribute('dir', 'ltr');
      expect(box).toHaveValue('');
      await waitFor(() => expect(resolveBarcode).toHaveBeenCalledTimes(1));
      expect(resolveBarcode.mock.calls[0]?.[0]).toBe(GOOD_EAN);
      expect(await screen.findByRole('img')).toBeTruthy();
    });

    it(`the copies box is a whole number read left to right; a refusal is marked on it and kept (${locale})`, async () => {
      const catalogue = catalogueOf(locale);
      const print = vi.fn();
      Object.defineProperty(window, 'print', { value: print, configurable: true });
      const user = userEvent.setup();
      renderIn(locale);
      await wedgeIn(user, catalogue, GOOD_EAN);
      await screen.findByRole('img');
      const copies = screen.getByLabelText(namedIn(catalogue)('inventory.labels.format.copies'));
      expect(copies).toHaveAttribute('dir', 'ltr');
      expect(copies).toHaveAttribute('inputmode', 'numeric');
      expect(copies).not.toHaveAttribute('type', 'number');
      await user.clear(copies);
      await user.type(copies, '0');
      await user.click(
        screen.getByRole('button', { name: catalogue['inventory.labels.print'] as string })
      );
      expect(copies).toHaveAttribute('aria-invalid', 'true');
      expect(copies).toHaveAccessibleDescription(
        new RegExp(escape(catalogue['inventory.labels.format.copiesRange'] as string))
      );
      expect(copies).toHaveValue('0');
      expect(print).not.toHaveBeenCalled();
      await user.type(copies, '{Backspace}2');
      expect(copies).not.toHaveAttribute('aria-invalid');
    });

    it(`a label that could not be read offers a retry that reads it again (${locale})`, async () => {
      const catalogue = catalogueOf(locale);
      readItemLabel.mockResolvedValueOnce({ status: 'unavailable', correlationId: 'corr-1' });
      const user = userEvent.setup();
      renderIn(locale);
      await wedgeIn(user, catalogue, GOOD_EAN);
      expect(
        await screen.findByText(catalogue['inventory.labels.unavailable'] as string)
      ).toBeVisible();
      expect(screen.getByText('corr-1')).toBeVisible();
      expect(screen.queryByRole('img')).toBeNull();
      await user.click(screen.getByRole('button', { name: catalogue['state.retry'] as string }));
      expect(await screen.findByRole('img')).toBeTruthy();
      expect(readItemLabel).toHaveBeenCalledTimes(2);
    });

    it(`a refused label is a refusal, with no retry (${locale})`, async () => {
      const catalogue = catalogueOf(locale);
      readItemLabel.mockResolvedValue({ status: 'denied', correlationId: 'corr-2' });
      const user = userEvent.setup();
      renderIn(locale);
      await wedgeIn(user, catalogue, GOOD_EAN);
      expect(
        await screen.findByText(catalogue['inventory.labels.refused'] as string)
      ).toBeVisible();
      expect(screen.queryByRole('button', { name: catalogue['state.retry'] as string })).toBeNull();
      expect(screen.queryByRole('img')).toBeNull();
    });
  }

  it('an item the server no longer knows keeps its own sentence', async () => {
    readItemLabel.mockResolvedValue({ status: 'not-found', correlationId: 'corr-3' });
    const user = userEvent.setup();
    renderIn('en');
    await wedgeIn(user, EN, GOOD_EAN);
    expect(await screen.findByText(EN['inventory.labels.missing'] as string)).toBeVisible();
    expect(screen.queryByRole('button', { name: EN['state.retry'] as string })).toBeNull();
  });

  it('has no serious or critical accessibility finding with a label drawn, in Arabic', async () => {
    const user = userEvent.setup();
    const { container } = renderIn('ar');
    await wedgeIn(user, AR, GOOD_EAN);
    await screen.findByRole('img');
    expect(await seriousViolations(container)).toEqual([]);
  });
});

/**
 * P1-32-PRE-OD-INVF — LBL-sheet-print and LBL-roll-print.
 *
 * The CP-20261009-1 Chrome PDFs printed the page heading and its description
 * above the labels, and a 50 x 25 mm roll of two labels as THREE pages: the
 * heading with the first label, the second label, and a blank page after the
 * last (`break-after: page` on every roll label). These hold the two causes
 * where a DOM test can see them — what the route opts into and what the
 * compiled print stylesheet says — and the pagination itself stays with the
 * next runtime print retest, which only a browser can measure.
 */
describe('P1-32-PRE-OD-INVF: a run of labels prints as labels only', () => {
  interface PrintRule {
    /** The selector as compiled, for `matches`. */
    readonly raw: string;
    /** The same with every quote removed, for comparison: Sass unquotes identifiers. */
    readonly selector: string;
    readonly print: boolean;
    readonly declarations: Readonly<Record<string, string>>;
  }

  const compiled = sass.compile(join(__dirname, '..', 'src', 'app', 'globals.scss')).css;
  const root = postcss.parse(compiled);
  const rules: PrintRule[] = [];
  root.walkRules((rule) => {
    let print = false;
    for (let node = rule.parent; node && node.type !== 'root'; node = node.parent) {
      if (node.type === 'atrule' && (node as AtRule).name === 'media') {
        print ||= /\bprint\b/.test((node as AtRule).params);
      }
    }
    const declarations: Record<string, string> = {};
    rule.walkDecls((decl) => {
      declarations[decl.prop] = decl.value;
    });
    for (const selector of rule.selectors) {
      rules.push({
        raw: selector.trim(),
        selector: selector.trim().replace(/["']/g, ''),
        print,
        declarations,
      });
    }
  });
  const labelRules = rules.filter((rule) => rule.selector.includes('[data-label'));

  it('breaks between roll labels and never after the last one', () => {
    for (const preset of ['50x25', '70x40']) {
      const cell = `[data-label-sheet=${preset}] [data-label=cell]`;
      const between = labelRules.find(
        (rule) => rule.print && rule.selector === `${cell} + [data-label=cell]`
      );
      expect(between?.declarations['break-before']).toBe('page');
      // No label rule forces a break AFTER a label: that is what left a blank
      // page, a wasted label on a roll printer, after the last one.
      for (const rule of labelRules) {
        expect(rule.declarations['break-after']).toBeUndefined();
        expect(rule.declarations['page-break-after']).toBeUndefined();
      }
      // The rule that applies to EVERY label (the first included) forces no break.
      const every = labelRules.filter((rule) => rule.print && rule.selector === cell);
      expect(every.length).toBeGreaterThan(0);
      for (const rule of every) expect(rule.declarations['break-before']).toBeUndefined();
    }
  });

  it('puts each roll label on a page the size of the label, with no margin', () => {
    const pages: Record<string, Record<string, string>> = {};
    root.walkAtRules('page', (rule) => {
      const declarations: Record<string, string> = {};
      rule.walkDecls((decl) => {
        declarations[decl.prop] = decl.value;
      });
      pages[rule.params.trim()] = declarations;
    });
    expect(pages['label-50x25']).toMatchObject({ size: '50mm 25mm', margin: '0' });
    expect(pages['label-70x40']).toMatchObject({ size: '70mm 40mm', margin: '0' });
    const named = (preset: string) =>
      labelRules.find(
        (rule) =>
          rule.print &&
          rule.selector === `[data-label-sheet=${preset}] [data-label=cell]` &&
          rule.declarations['page'] !== undefined
      )?.declarations['page'];
    expect(named('50x25')).toBe('label-50x25');
    expect(named('70x40')).toBe('label-70x40');
  });

  it('leaves the sheet title off the paper, so a run starts with a label', () => {
    const header = rules.find(
      (rule) =>
        rule.print && rule.selector === '[data-print=document]:has([data-label-sheet]) > header'
    );
    expect(header?.declarations['display']).toBe('none');
  });

  it('a roll of two labels: only the second is broken before, and nothing follows the last', async () => {
    const user = userEvent.setup();
    const { container } = renderLtr(<LabelsScreen locale="en" messages={en} />);
    await wedge(user, GOOD_EAN);
    await screen.findAllByRole('img');
    const copies = screen.getByLabelText(labelled('inventory.labels.format.copies'));
    await user.clear(copies);
    await user.type(copies, '2');
    await waitFor(() =>
      expect(
        container.querySelectorAll('[data-label-sheet="50x25"] [data-label="cell"]')
      ).toHaveLength(2)
    );
    const cells = [
      ...container.querySelectorAll<HTMLElement>('[data-label-sheet="50x25"] [data-label="cell"]'),
    ];
    const breakBefore = labelRules.filter(
      (rule) => rule.print && rule.declarations['break-before'] === 'page'
    );
    expect(breakBefore.length).toBeGreaterThan(0);
    const breaks = cells.map((cell) => breakBefore.some((rule) => cell.matches(rule.raw)));
    expect(breaks).toEqual([false, true]);
  });

  it('the route opts into the print scope, so its heading and description stay off the paper', async () => {
    const user = userEvent.setup();
    PERMISSIONS = ['inv.item.read'];
    const { container } = renderLtr(
      (await LabelsPage({ params: Promise.resolve({ locale: 'en' }) })) as React.ReactElement
    );
    await wedge(user, GOOD_EAN);
    await screen.findAllByRole('img');
    const scope = container.querySelector<HTMLElement>('[data-print-scope="document"]');
    expect(scope).not.toBeNull();
    const sheet = scope?.querySelector('[data-print="document"]');
    expect(sheet).not.toBeNull();
    // The scope's rule leaves off every direct child holding no document: the
    // page heading and its description are in such a child.
    const heading = screen.getByRole('heading', {
      level: 1,
      name: EN['inventory.labels.title'] as string,
    });
    const description = screen.getByText(EN['inventory.labels.description'] as string);
    for (const node of [heading, description]) {
      const child = [...(scope?.children ?? [])].find((candidate) => candidate.contains(node));
      expect(child).toBeDefined();
      expect(child?.contains(sheet ?? null)).toBe(false);
    }
  });
});
