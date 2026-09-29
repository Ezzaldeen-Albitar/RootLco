/**
 * P1-32-PRE-OD-FIN — the database-free halves of two finance corrections.
 *
 *  - GAP-04: what a sales return SHOWS is its credit note's own decision. The
 *    stored `credited` is written while the note is still pending, so a return
 *    must never read "credited" until the note is approved.
 *  - M-07: the invoice-and-payment report publishes a drill-through for EVERY kind
 *    of document it lists, a credit note included, and each template names a
 *    route the API actually serves — a template that resolves nowhere is a link
 *    that cannot open, and a null where a read exists is a link withheld.
 *
 * Each assertion is written so it fails if the correction is removed.
 */
import { describe, expect, it } from 'vitest';
import {
  SALES_RETURN_DISPLAY_STATES,
  SALES_RETURN_STATES,
  salesReturnDisplayState,
} from '@api/modules/inventory/domain/inventory';
import { REPORT_DATASETS } from '@api/modules/reporting/domain/report-datasets';
import { ROUTE_TEMPLATES } from '@api/server/http/route-templates';

describe('GAP-04 — a sales return shows its credit note’s decision', () => {
  it('derives every shown state from the note, never from the stored value', () => {
    expect(salesReturnDisplayState(null, null)).toBe('received');
    expect(salesReturnDisplayState('note-1', 'pending')).toBe('credit_requested');
    expect(salesReturnDisplayState('note-1', 'approved')).toBe('credited');
    expect(salesReturnDisplayState('note-1', 'rejected')).toBe('credit_rejected');
  });

  it('never calls a pending credit "credited"', () => {
    expect(salesReturnDisplayState('note-1', 'pending')).not.toBe('credited');
  });

  it('says only that a note was raised when the reader may not see its decision', () => {
    // The note row is hidden by RLS from a reader without sal.finance.view, so
    // the join yields no approval state; nothing is guessed from it.
    expect(salesReturnDisplayState('note-1', null)).toBe('credit_raised');
    expect(salesReturnDisplayState('note-1', 'something new')).toBe('credit_raised');
  });

  it('publishes exactly the five shown states, beside the two stored ones', () => {
    expect([...SALES_RETURN_DISPLAY_STATES]).toEqual([
      'received',
      'credit_requested',
      'credited',
      'credit_rejected',
      'credit_raised',
    ]);
    expect([...SALES_RETURN_STATES]).toEqual(['received', 'credited']);
  });
});

describe('M-07 — every document kind in the report drills through to a served route', () => {
  const placeholder = /\{[^}]+\}/g;
  const served = new Set(ROUTE_TEMPLATES.map((template) => template.replace(placeholder, '{}')));
  const document = REPORT_DATASETS.invoice_payment_summary.columns.find(
    (column) => column.key === 'document'
  );

  it('publishes a template, never null, for invoices, receipts and credit notes', () => {
    const templates: Readonly<Record<string, string | null>> =
      document?.drillThroughByKind?.templates ?? {};
    expect(Object.keys(templates).sort()).toEqual(['credit_note', 'invoice', 'receipt']);
    expect(templates['credit_note']).toBe('/credit-notes/{id}');
    for (const [kind, template] of Object.entries(templates)) {
      expect(template, kind).not.toBeNull();
    }
  });

  it('names only routes the API registers', () => {
    const templates = Object.values(document?.drillThroughByKind?.templates ?? {});
    expect(templates.length).toBeGreaterThan(0);
    for (const template of templates) {
      expect(served.has(String(template).replace(placeholder, '{}')), String(template)).toBe(true);
    }
  });
});
