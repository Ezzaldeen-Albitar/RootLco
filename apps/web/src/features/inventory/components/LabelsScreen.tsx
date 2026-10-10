'use client';

/**
 * Printable shelf and part labels (P1-32).
 *
 * ## What a label is for
 *
 * A part on a shelf with no code on it cannot be scanned, so it is counted by
 * hand, sold by hand and mis-picked by hand. This screen prints the code the
 * server already holds — it invents nothing, and it prints nothing for an item
 * that carries no live code, because a blank label is worse than no label.
 *
 * ## An item is chosen by scanning it or by finding it
 *
 * Both routes end in the same place: `inv.item-label-data` for the chosen item.
 * Scanning resolves through `inv.barcode-resolve`, which answers with the ITEM —
 * never a unit, and never a guess when a code is carried by two items.
 *
 * ## The bars are drawn here and the numbers are printed under them
 *
 * `@/lib/barcode/encode` computes the geometry and `BarcodeImage` draws one
 * element per bar. The stock code, the item name and the code itself are
 * ordinary text beneath, so a person can read the label when the scanner cannot
 * and a picker can check that the right label went on the right shelf.
 *
 * ## Size presets, copies, and what the print dialog still owns
 *
 * Three presets — two single-label sizes and an A4 sheet — set the physical size
 * of each label through print CSS. The paper itself is chosen in the browser's
 * print dialog, which no page can do on the operator's behalf; the screen says
 * so rather than implying the sheet size is decided here.
 *
 * ## On Material UI (ADR-022, `P1-32-PRE-OD-INV6`)
 *
 * The size is `FormSelectField` (native, F6), the copies `FormNumberField`
 * (whole numbers, left to right, the digits typed are the value), and the two
 * buttons are Material's. The scan box and the item finder are the shared
 * inventory pieces. The wait for a label is `MuiLoadingState` saying this
 * screen's own sentence, and a label that could not be read is the shared
 * failure state carrying the screen's own sentence (a retry only for an outage
 * or a fault), except an item the server no longer knows, which keeps its own
 * sentence. The printed sheet is unchanged: `PrintDocument` with no
 * `reference`, so a sheet of labels carries no repeated identity row.
 */

import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';

import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { PrintDocument } from '@/components/print/PrintDocument';
import { MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadFailureStatus } from '@/lib/api/read-operation';

import { readItemLabel, resolveBarcode } from '../api';
import { type InventoryItem, type ItemLabel } from '../inventory-contract';
import { BarcodeImage } from './BarcodeImage';
import { ScanBox } from './ScanBox';
import { ItemFinder, PANEL, StockOperationLinks } from './stock-operations';

/** The label sizes on offer. The value is what the print stylesheet keys on. */
export const LABEL_PRESETS = ['50x25', '70x40', 'a4'] as const;
export type LabelPreset = (typeof LABEL_PRESETS)[number];

/** How many labels one print run may produce. A bound, so a typo cannot empty a roll. */
export const MAX_COPIES = 60;

export function LabelsScreen({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [preset, setPreset] = useState<LabelPreset>('50x25');
  const [copies, setCopies] = useState('1');
  const [copiesError, setCopiesError] = useState<string | null>(null);

  const onScanned = useCallback((code: string) => {
    setScanNote('inventory.labels.scan.looking');
    void resolveBarcode(code).then((state) => {
      if (state.status === 'ok') {
        setChosenId(state.data.item.id);
        setItem(null);
        setScanNote(null);
        return;
      }
      setScanNote(
        state.status === 'not-found'
          ? 'inventory.scan.notFound'
          : state.status === 'denied'
            ? 'inventory.scan.refused'
            : state.status === 'error'
              ? 'inventory.scan.ambiguous'
              : 'inventory.scan.unavailable'
      );
    });
  }, []);

  const itemId = chosenId ?? item?.id ?? null;
  const readable = copiesFrom(copies);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div data-print="hide" className="flex flex-col gap-4">
        <StockOperationLinks locale={locale} messages={messages} />
        <p className="text-caption text-text-muted">
          {translate(messages, 'inventory.labels.explain')}
        </p>
        <section aria-labelledby="label-choose-heading" className={PANEL}>
          <h2 id="label-choose-heading" className="text-body font-medium text-text-primary">
            {translate(messages, 'inventory.labels.choose.heading')}
          </h2>
          <ScanBox
            messages={messages}
            idPrefix="labels"
            label={translate(messages, 'inventory.scan.label')}
            description={translate(messages, 'inventory.scan.help')}
            onCode={onScanned}
          />
          {scanNote !== null ? (
            <p role="status" className="text-caption text-text-muted">
              {translateDynamic(messages, scanNote)}
            </p>
          ) : null}
          <ItemFinder
            messages={messages}
            idPrefix="labels"
            value={item}
            onChange={(next) => {
              setItem(next);
              setChosenId(next?.id ?? null);
            }}
          />
        </section>

        <section aria-labelledby="label-format-heading" className={PANEL}>
          <h2 id="label-format-heading" className="text-body font-medium text-text-primary">
            {translate(messages, 'inventory.labels.format.heading')}
          </h2>
          <p className="text-caption text-text-muted">
            {translate(messages, 'inventory.labels.format.paperNote')}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormSelectField
              label={translate(messages, 'inventory.labels.format.size')}
              value={preset}
              onChange={(next) => setPreset(next as LabelPreset)}
              options={LABEL_PRESETS.map((value) => ({
                value,
                label: translateDynamic(messages, `inventory.labels.size.${value}`),
              }))}
            />
            <FormNumberField
              label={translate(messages, 'inventory.labels.format.copies')}
              integer
              value={copies}
              onChange={(next) => {
                setCopies(next);
                setCopiesError(null);
              }}
              error={copiesError ? translateDynamic(messages, copiesError) : undefined}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="contained"
              disabled={itemId === null}
              onClick={() => {
                if (readable === null) {
                  setCopiesError('inventory.labels.format.copiesRange');
                  return;
                }
                setCopiesError(null);
                if (typeof window !== 'undefined') window.print();
              }}
            >
              {translate(messages, 'inventory.labels.print')}
            </Button>
            {itemId !== null ? (
              <Button
                type="button"
                variant="outlined"
                onClick={() => {
                  setChosenId(null);
                  setItem(null);
                  setScanNote(null);
                }}
              >
                {translate(messages, 'inventory.labels.clear')}
              </Button>
            ) : null}
          </div>
        </section>
      </div>

      {itemId === null ? (
        <p data-print="hide" className="text-caption text-text-muted">
          {translate(messages, 'inventory.labels.noItem')}
        </p>
      ) : (
        <LabelSheet
          key={itemId}
          locale={locale}
          messages={messages}
          itemId={itemId}
          preset={preset}
          copies={readable ?? 1}
        />
      )}
    </div>
  );
}

/** The copies box as a whole number within the bound, or null. No `Number()` — the digits are the value. */
function copiesFrom(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const counted = [...text].reduce(
    (carried, digit) => carried * 10 + '0123456789'.indexOf(digit),
    0
  );
  if (counted < 1 || counted > MAX_COPIES) return null;
  return counted;
}

function LabelSheet({
  locale,
  messages,
  itemId,
  preset,
  copies,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly itemId: string;
  readonly preset: LabelPreset;
  readonly copies: number;
}) {
  const [state, setState] = useState<
    | { readonly phase: 'loading' }
    | { readonly phase: 'read'; readonly label: ItemLabel }
    | {
        readonly phase: 'failed';
        readonly status: ReadFailureStatus;
        readonly correlationId: string | null;
      }
  >({ phase: 'loading' });
  /* Moves on with every "Try again", which reads the label again. */
  const [round, setRound] = useState(0);

  /*
   * No loading state is set here: the sheet is keyed on the item at its call
   * site, so a different item mounts a fresh component that already starts at
   * `loading`. Setting it inside the effect would be a second render per read.
   */
  useEffect(() => {
    let live = true;
    void readItemLabel(itemId).then((answer) => {
      if (!live) return;
      if (answer.status === 'ok') {
        setState({ phase: 'read', label: answer.data });
        return;
      }
      setState({ phase: 'failed', status: answer.status, correlationId: answer.correlationId });
    });
    return () => {
      live = false;
    };
  }, [itemId, round]);

  if (state.phase === 'loading') {
    return (
      <MuiLoadingState messages={messages} variant="inline" labelKey="inventory.labels.loading" />
    );
  }
  if (state.phase === 'failed') {
    if (state.status === 'not-found') {
      // An item the server no longer knows: this screen's own sentence, as before.
      return (
        <Alert severity="warning" variant="outlined" role="status">
          {translate(messages, 'inventory.labels.missing')}
        </Alert>
      );
    }
    return (
      <MuiReadFailureState
        messages={messages}
        locale={locale}
        status={state.status}
        correlationId={state.correlationId}
        descriptionKey={
          state.status === 'denied' ? 'inventory.labels.refused' : 'inventory.labels.unavailable'
        }
        onRetry={() => {
          setState({ phase: 'loading' });
          setRound((n) => n + 1);
        }}
      />
    );
  }

  const { label } = state;
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
              <p className="text-caption text-text-muted" dir="ltr">
                {label.packQuantity} {label.unit.code}
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
