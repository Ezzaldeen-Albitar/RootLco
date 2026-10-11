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
              <p className="text-caption font-medium text-text-primary">{label.name}</p>
              <p className="text-caption text-text-secondary" dir="ltr">
                {label.sku}
              </p>
              <p className="text-caption text-text-muted">
                <bdi dir="ltr">{label.packQuantity}</bdi>{' '}
                <bdi>{unitNameByCode(messages, label.unit.code, units)}</bdi>
              </p>
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
