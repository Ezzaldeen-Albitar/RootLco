/**
 * A barcode drawn as React elements — one `<rect>` per black bar.
 *
 * ## Why it is built this way
 *
 * `dangerouslySetInnerHTML` is banned in this application and no rendering
 * dependency was added, so the symbol arrives here as GEOMETRY from
 * `@/lib/barcode/encode` — a list of bars in symbol modules — and this component
 * turns each into an element. Nothing is parsed, nothing is injected, and this
 * file knows nothing about any symbology.
 *
 * ## The human-readable line is HTML, not SVG text
 *
 * A label is useless when the scanner cannot read it and the operator cannot
 * either. The digits therefore live outside the drawing, as ordinary text a
 * person can select, a screen reader can announce and a test can find by its
 * accessible name — rather than as `<text>` inside a graphic, where they would
 * be none of those things.
 *
 * ## The drawing itself is decorative, and says so
 *
 * The `<svg>` carries `role="img"` and a label naming the symbology and the
 * code, so a screen reader states what the picture is instead of reading a
 * hundred rectangles.
 */
import { encodeBarcode, type Symbology } from '@/lib/barcode/encode';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';

/** Drawn height of the bars, in the same module units the encoder returns. */
const BAR_HEIGHT_MODULES = 40;

export function BarcodeImage({
  messages,
  symbology,
  value,
  /** The line printed under the bars. Defaults to the code itself. */
  readable,
}: {
  readonly messages: Messages;
  readonly symbology: Symbology;
  readonly value: string;
  readonly readable?: string;
}) {
  const result = encodeBarcode(symbology, value);
  const text = readable ?? value;

  if (!result.ok) {
    /*
     * Said, never approximated. Drawing a fourteen-digit code in another
     * symbology would produce a label that scans back as something other than
     * what it claims, which is worse than a label that carries only the number.
     */
    return (
      <div className="flex flex-col gap-1">
        <p className="text-caption text-error">
          {translateDynamic(messages, `inventory.labels.refusal.${result.refusal}`)}
        </p>
        <code className="font-mono text-body tracking-widest" dir="ltr">
          {text}
        </code>
      </div>
    );
  }

  const { bars, span } = result.barcode;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        role="img"
        aria-label={`${translate(messages, 'inventory.labels.barcodeLabel')} ${text}`}
        viewBox={`0 0 ${span} ${BAR_HEIGHT_MODULES}`}
        preserveAspectRatio="none"
        className="h-12 w-full"
      >
        {bars.map((bar) => (
          <rect
            key={bar.x}
            x={bar.x}
            y={0}
            width={bar.width}
            height={BAR_HEIGHT_MODULES}
            fill="currentColor"
          />
        ))}
      </svg>
      <code className="font-mono text-caption tracking-widest" dir="ltr">
        {text}
      </code>
    </div>
  );
}
