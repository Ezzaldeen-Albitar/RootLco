/**
 * Negative fixture for the encoding-hygiene gate (P1-15).
 *
 * `npm run validate:encoding` currently reports zero of everything across the
 * whole repository, which is exactly the state in which a broken detector and a
 * working one look identical. This suite drives the pure `inspectBytes()` with
 * synthetic damage and proves each signature actually fires — and, as the
 * control, that ordinary content with legitimate non-ASCII does not.
 *
 * The last part matters more than it looks. This repository contains Arabic,
 * em dashes, middle dots and accented Latin on purpose. A mojibake detector
 * that fired on any of those would be turned off within a week, which is the
 * usual way a security-adjacent lint dies.
 */
import { describe, expect, it } from 'vitest';
import { inspectBytes, MOJIBAKE, TEXT } from '../../scripts/check-encoding.mjs';

/** Builds a buffer from code points, so this file carries no damaged text. */
const bytesOf = (...codePoints: number[]): Buffer =>
  Buffer.from(String.fromCodePoint(...codePoints), 'utf8');

const utf8 = (text: string): Buffer => Buffer.from(text, 'utf8');

describe('encoding gate — the damage it is meant to catch', () => {
  it('detects a UTF-8 byte-order mark', () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8('const a = 1;\n')]);
    expect(inspectBytes(withBom).bom).toBe(true);
  });

  it('does not mistake ordinary leading bytes for a byte-order mark', () => {
    expect(inspectBytes(utf8('const a = 1;\n')).bom).toBe(false);
  });

  it('detects U+FFFD, which means a decode already failed', () => {
    // 0xFFFD REPLACEMENT CHARACTER, produced by every lossy decode.
    expect(inspectBytes(bytesOf(0x63, 0xfffd, 0x64)).replacement).toBe(true);
  });

  it('detects an em dash that was decoded as Latin-1 and re-encoded', () => {
    // U+2014 in UTF-8 is E2 80 94; read as Latin-1 that is U+00E2 U+20AC U+201D.
    const damaged = bytesOf(0x41, 0x00e2, 0x20ac, 0x201d, 0x42);
    expect(inspectBytes(damaged).mojibake).toBe('General Punctuation re-encoded');
  });

  it('detects a middle dot that was decoded as Latin-1 and re-encoded', () => {
    // U+00B7 in UTF-8 is C2 B7; read as Latin-1 that is U+00C2 U+00B7.
    const damaged = bytesOf(0x41, 0x00c2, 0x00b7, 0x42);
    expect(inspectBytes(damaged).mojibake).toBe('Latin-1 punctuation re-encoded');
  });

  it('detects an accented Latin letter that was decoded as Latin-1 and re-encoded', () => {
    // U+00E9 in UTF-8 is C3 A9; read as Latin-1 that is U+00C3 U+00A9.
    const damaged = bytesOf(0x41, 0x00c3, 0x00a9, 0x42);
    expect(inspectBytes(damaged).mojibake).toBe('accented Latin re-encoded');
  });
});

describe('encoding gate — the content it must leave alone', () => {
  const clean = [
    { name: 'an em dash in prose', text: 'RootLco — Root Link Company' },
    { name: 'a middle dot in a header', text: '**Phase:** P1-15 · **Date:** 2026-07-23' },
    { name: 'curly quotes', text: '“the frozen contract”' },
    { name: 'an accented Latin letter', text: 'café résumé' },
    { name: 'Arabic', text: 'مرحبا بالعالم' },
    { name: 'Arabic-Indic digits', text: '٠١٢٣٤' },
    { name: 'a lone U+00E2 in prose', text: 'pâte' },
    { name: 'a lone U+00C3 at the end', text: 'ends with Ã' },
  ];

  for (const sample of clean) {
    it(`leaves ${sample.name} alone`, () => {
      const verdict = inspectBytes(utf8(sample.text));
      expect(verdict.bom).toBe(false);
      expect(verdict.replacement).toBe(false);
      expect(verdict.mojibake).toBeNull();
    });
  }
});

describe('encoding gate — scope', () => {
  it('declares exactly three signatures, each with a name and a pattern', () => {
    expect(MOJIBAKE).toHaveLength(3);
    for (const signature of MOJIBAKE) {
      expect(typeof signature.name).toBe('string');
      expect(signature.pattern).toBeInstanceOf(RegExp);
    }
  });

  it('covers the text extensions this repository actually commits', () => {
    for (const path of [
      'src/server/db/pool.ts',
      'src/app/page.tsx',
      'scripts/check-encoding.mjs',
      'docs/phase-1/phase-1-15/README.md',
      'supabase/migrations/20260101000000_init.sql',
      '.github/workflows/ci.yml',
      'src/styles/app.scss',
      'package.json',
    ]) {
      expect(TEXT.test(path), path).toBe(true);
    }
  });

  it('leaves binary and generated artefacts out of scope', () => {
    for (const path of ['docs/plan.docx', 'public/logo.png', 'certs/key.pem']) {
      expect(TEXT.test(path), path).toBe(false);
    }
  });
});
