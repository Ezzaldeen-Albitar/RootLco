import { PrintDocument } from '@/components/print/PrintDocument';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { unitNameByCode, type NamedUnit } from '@/lib/unit-name';

import type { ItemLabel } from '../inventory-contract';
import { BarcodeImage } from './BarcodeImage';

/** The label sizes on offer. The value is what the print stylesheet keys on. */
export const LABEL_PRESETS = ['50x25', '70x40', 'a4'] as const;
export type LabelPreset = (typeof LABEL_PRESETS)[number];

/**
 * One run of labels for one item, as it prints (P1-32; P1-32-PRE-OD-INVF).
 *
 * Separate from the screen that reads the label so the run can be printed by
 * the browser tier from fixture props alone (`tests/e2e/print-layout.spec.ts`):
 * pagination — a label per roll page, nothing after the last, the sheet
 * starting with a label — only exists in a browser's print layout.
 *
 * `PrintDocument` with no `reference`: a sheet of labels carries no repeated
 * identity row, and its title is for the screen only (the print stylesheet
 * leaves it off the paper).
 *
 * A label carries the bars, the code, the name and the stock code, and the two
 * larger sizes end with the pack quantity and its unit. The 50 x 25 mm label
 * does not carry that last row (P1-32-PRE-OD-INVG): it never fitted there —
 * it was cut off, on screen and on paper — and it fits only with shorter bars.
 * Whether the smallest label should carry it, on a larger label or with
 * shorter bars and a scan test, is an open Owner decision; until it is made
 * the row is not drawn where it cannot be read. The rows below the code are
 * marked `data-label="line"` so the print stylesheet can give each a fixed
 * height on that label.
 */
export function LabelRun({
  locale,
  messages,
  label,
  preset,
  copies,
  units,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly label: ItemLabel;
  readonly preset: LabelPreset;
  readonly copies: number;
  /** The units the label's unit code is named from; `null` shows the code. */
  readonly units: readonly NamedUnit[] | null;
}) {
  const printed = label.primaryBarcode;
  return (
    <PrintDocument title={translate(messages, 'inventory.labels.documentTitle')}>
      {printed === null ? (
        <p className="text-body text-error">{translate(messages, 'inventory.labels.noCode')}</p>
      ) : (
        <div data-label-sheet={preset}>
          {Array.from({ length: copies }, (_unused, index) => (
            <div key={index} data-label="cell" lang={locale}>
              <BarcodeImage
                messages={messages}
                symbology={printed.symbology}
                value={printed.normalizedValue}
                readable={printed.value}
              />
              {/*
               * `dir="auto"`: a name reads from its own first letter, whatever
               * the page language, so a name too long for the smallest label
               * loses its end to the ellipsis and never its beginning.
               */}
              <p
                data-label="line"
                dir="auto"
                className="text-caption font-medium text-text-primary"
              >
                {label.name}
              </p>
              <p data-label="line" className="text-caption text-text-secondary" dir="ltr">
                {label.sku}
              </p>
              {preset === '50x25' ? null : (
                <p data-label="line" className="text-caption text-text-muted">
                  <bdi dir="ltr">{label.packQuantity}</bdi>{' '}
                  <bdi>{unitNameByCode(messages, label.unit.code, units)}</bdi>
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      <p data-print="hide" className="mt-4 text-caption text-text-muted">
        {translate(messages, 'inventory.labels.noPriceNote')}
      </p>
    </PrintDocument>
  );
}
