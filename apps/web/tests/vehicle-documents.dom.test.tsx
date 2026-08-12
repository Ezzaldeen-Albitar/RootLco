import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import { VehicleDocumentsSection } from '@/features/vehicles/components/VehicleDocumentsSection';
import { MEDIA_BLOCKING_DECISION } from '@/features/vehicles/documents-contract';

/**
 * The vehicle documents SECTION (`P1-27-FE-026`, `P1-27-FE-027`).
 *
 * ## Why this file exists
 *
 * The component was rendered by no test at any tier. Its only mount point is
 * `VehicleProfileScreen`, which was itself rendered by no test, so every state
 * it owns — five of them — was invisible.
 *
 * ## The upload that must NOT be here
 *
 * `P1-OD-025` (vehicle document and media file policy) is an open Owner
 * decision. The frontend gate's `no-upload-path` rule forbids the affordance and
 * the canonical plan requires the screen to state the policy is pending rather
 * than offer a control. So its absence is the delivered behaviour, not a gap —
 * and this file asserts the absence rather than leaving it to the gate, because
 * a gate matching three literal patterns is not the same as a screen proven to
 * offer nothing.
 *
 * ## The permission is inverted relative to every other section
 *
 * This tab needs `shared.document.manage` — a MANAGE capability from a different
 * module — while every other vehicle section needs `veh.vehicle.read`. An
 * operator who can see the whole vehicle and not this list is a normal case, and
 * the screen names the missing capability instead of showing an empty panel.
 */

function render(
  state: Record<string, unknown>,
  canListDocuments = true,
  locale: 'en' | 'ar' = 'en'
) {
  const messages = locale === 'en' ? en : ar;
  const view = locale === 'en' ? renderLtr : renderRtl;
  return view(
    <VehicleDocumentsSection
      locale={locale}
      messages={messages}
      state={state as never}
      canListDocuments={canListDocuments}
    />
  );
}

describe('there is no upload path, and no promise of one', () => {
  it('offers no file input, no form and no upload control', () => {
    const { container } = render({ status: 'ok', documentIds: ['d1'] });
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button', { name: /upload|attach|add/i })).toBeNull();
  });

  it('states that the media policy is pending, and names the decision', () => {
    const { container } = render({ status: 'ok', documentIds: [] });
    expect(screen.getByText(en['vehicles.media.blocked'])).toBeInTheDocument();
    // The decision reference, so an operator asking "why not?" has an answer
    // rather than a blank panel.
    expect(container.textContent ?? '').toContain(MEDIA_BLOCKING_DECISION);
    expect(MEDIA_BLOCKING_DECISION).toContain('P1-OD-025');
  });

  it('offers no download control either', () => {
    // `shared.attachment-download-authorize` is `auditClass: 'security'`, so
    // warming a link would write a security audit record for a download nobody
    // performed.
    const { container } = render({ status: 'ok', documentIds: ['d1', 'd2'] });
    expect(container.querySelector('a[href]')).toBeNull();
    expect(screen.getByText(en['vehicles.documents.downloadNote'])).toBeInTheDocument();
  });
});

describe('each of the five states says what it is', () => {
  it('lists the references and their real count', () => {
    const { container } = render({ status: 'ok', documentIds: ['d1', 'd2', 'd3'] });
    // A real count, not a page of an unknown total — the operation returns the
    // whole list and publishes no `total` to invent.
    expect(container.textContent ?? '').toContain('3');
    expect(container.querySelectorAll('li')).toHaveLength(3);
  });

  it('says "none" for an empty list rather than showing nothing', () => {
    render({ status: 'ok', documentIds: [] });
    expect(screen.getByText(en['vehicles.documents.none'])).toBeInTheDocument();
  });

  it('keeps "no such vehicle" apart from "no documents"', () => {
    const { container } = render({ status: 'not-found' });
    expect(screen.getByText(en['vehicles.documents.vehicleNotFound'])).toBeInTheDocument();
    // The distinction the adapter preserves must survive into the markup.
    expect(container.textContent ?? '').not.toContain(en['vehicles.documents.none']);
  });

  it('announces a failed read and shows the reference to quote', () => {
    const { container } = render({ status: 'unavailable', correlationId: 'corr-9' });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent ?? '').toContain('corr-9');
    // A failed read is not an empty list.
    expect(container.textContent ?? '').not.toContain(en['vehicles.documents.none']);
  });

  it('names the missing capability instead of showing an empty panel', () => {
    const { container } = render({ status: 'ok', documentIds: ['d1'] }, false);
    expect(screen.getByText(en['vehicles.documents.needsOtherPermission'])).toBeInTheDocument();
    // And shows no rows, because the caller may not read them.
    expect(container.querySelectorAll('li')).toHaveLength(0);
    expect(container.textContent ?? '').not.toContain('d1');
  });
});

describe('a reference is presented as a reference', () => {
  it('renders each id inert — no link, no object key, no storage host', () => {
    const { container } = render({ status: 'ok', documentIds: ['d1'] });
    const code = container.querySelector('code');
    expect(code?.textContent).toBe('d1');
    expect(code?.closest('a')).toBeNull();
    // No storage assumption anywhere: an object key is not authorization, and a
    // bucket host in the markup would be one.
    const text = container.innerHTML;
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/s3|blob|bucket|storage\./i);
  });

  it('says the operation publishes no metadata, rather than implying it has none', () => {
    render({ status: 'ok', documentIds: ['d1'] });
    expect(screen.getByText(en['vehicles.documents.noMetadata'])).toBeInTheDocument();
  });
});

describe('Arabic', () => {
  it('renders every state right-to-left', () => {
    render({ status: 'ok', documentIds: [] }, true, 'ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText(ar['vehicles.documents.none'])).toBeInTheDocument();
  });

  it('names the missing capability in Arabic too', () => {
    render({ status: 'ok', documentIds: ['d1'] }, false, 'ar');
    expect(screen.getByText(ar['vehicles.documents.needsOtherPermission'])).toBeInTheDocument();
  });
});

describe('this file is not vacuous', () => {
  it('really rendered the section, which no previous test did', () => {
    const { container } = render({ status: 'ok', documentIds: ['d1'] });
    expect(container.querySelectorAll('section')).toHaveLength(2);
    expect(screen.getByText(en['vehicles.documents.heading'])).toBeInTheDocument();
    expect(screen.getByText(en['vehicles.media.heading'])).toBeInTheDocument();
  });

  it('asserts against copy present in both catalogues', () => {
    for (const key of [
      'vehicles.documents.heading',
      'vehicles.documents.none',
      'vehicles.documents.needsOtherPermission',
      'vehicles.documents.vehicleNotFound',
      'vehicles.documents.readFailed',
      'vehicles.documents.downloadNote',
      'vehicles.documents.noMetadata',
      'vehicles.media.blocked',
    ]) {
      expect(Object.keys(en), key).toContain(key);
      expect(Object.keys(ar), key).toContain(key);
      expect((en as Record<string, string>)[key]).not.toBe((ar as Record<string, string>)[key]);
    }
  });
});
