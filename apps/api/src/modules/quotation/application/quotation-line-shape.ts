/**
 * The two shapes of a requested quotation line (P1-32-PRE-OD-FD6, ADR-023 D6).
 *
 * A SERVICE line names a service of the catalogue, and is what every caller sent
 * before part lines existed — so `kind` defaults to `service` and a request that
 * names no kind means exactly what it always meant. A PART line names an item of
 * the inventory catalogue. Neither carries a price: the server resolves it.
 *
 * Both route schemas (`POST /quotations`, `POST /quotations/{id}/revisions`) are
 * one strict object with every field optional, refined here, rather than a union:
 * a union reports a malformed quantity as "no branch matched" at the line, where
 * a refined object still reports it at `lines.<n>.quantity`, the field the
 * operator can correct. A field that is missing is `invalid_type`, the token a
 * missing required field always produced; a field the kind does not take is a
 * named refusal at that field.
 */
import type { RefinementCtx } from 'zod';
import type { ItemKind } from '../domain/quotation';

interface LineShape {
  readonly kind?: ItemKind | undefined;
  readonly serviceId?: string | undefined;
  readonly itemId?: string | undefined;
  readonly sourceServiceLineRef?: string | undefined;
  readonly sourceRequiredPartRef?: string | undefined;
}

/** The fields a line of each kind must name, and the fields it may not. */
const SHAPES: Readonly<
  Record<ItemKind, { required: keyof LineShape; refused: readonly (keyof LineShape)[] }>
> = {
  service: { required: 'serviceId', refused: ['itemId', 'sourceRequiredPartRef'] },
  part: { required: 'itemId', refused: ['serviceId', 'sourceServiceLineRef'] },
};

/** `superRefine` for a requested line: the fields its kind requires and refuses. */
export function refineQuotationLine(line: LineShape, context: RefinementCtx): void {
  const shape = SHAPES[line.kind ?? 'service'];
  if (line[shape.required] === undefined) {
    context.addIssue({
      code: 'invalid_type',
      expected: 'string',
      input: undefined,
      path: [shape.required],
      message: `a ${line.kind ?? 'service'} line must name ${shape.required}`,
    });
  }
  for (const field of shape.refused) {
    if (line[field] !== undefined) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `a ${line.kind ?? 'service'} line does not take ${field}`,
      });
    }
  }
}
