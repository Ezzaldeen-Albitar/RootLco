import { inflateSync } from 'node:zlib';

/**
 * The text of each page of a PDF that Chromium printed, in paint order.
 *
 * Deliberately small, and deliberately only for Chromium's own output (Skia's
 * PDF writer): plain indirect objects, Flate-compressed content streams, and
 * text drawn as hex glyph strings in a Type0 font whose `ToUnicode` map turns
 * glyphs back into characters. That is all this needs to answer "what is on
 * page N", which is the question a print-layout regression is about, and it
 * keeps the browser tier free of a PDF library. A PDF it cannot read throws —
 * it never returns an empty page that would read as a blank one.
 */

interface PdfObject {
  readonly dict: string;
  readonly stream: Buffer | null;
}

function parseObjects(pdf: Buffer): Map<number, PdfObject> {
  const text = pdf.toString('latin1');
  const objects = new Map<number, PdfObject>();
  const header = /(\d+) 0 obj\b/g;
  let match: RegExpExecArray | null;
  while ((match = header.exec(text)) !== null) {
    const id = Number(match[1]);
    const start = match.index + match[0].length;
    const streamAt = text.indexOf('stream', start);
    const endAt = text.indexOf('endobj', start);
    if (endAt < 0) throw new Error(`object ${id} has no end`);
    if (streamAt >= 0 && streamAt < endAt) {
      const dict = text.slice(start, streamAt);
      let dataStart = streamAt + 'stream'.length;
      if (text[dataStart] === '\r') dataStart += 1;
      if (text[dataStart] === '\n') dataStart += 1;
      const length = /\/Length (\d+)(?! \d+ R)/.exec(dict);
      const dataEnd = length ? dataStart + Number(length[1]) : text.indexOf('endstream', dataStart);
      const raw = pdf.subarray(dataStart, dataEnd);
      const stream = /\/FlateDecode/.test(dict) ? inflateSync(raw) : raw;
      objects.set(id, { dict, stream });
      header.lastIndex = text.indexOf('endobj', dataEnd);
    } else {
      objects.set(id, { dict: text.slice(start, endAt), stream: null });
      header.lastIndex = endAt;
    }
  }
  return objects;
}

function ref(dict: string, key: string): number | null {
  const found = new RegExp(`/${key} (\\d+) 0 R`).exec(dict);
  return found ? Number(found[1]) : null;
}

function refs(list: string): number[] {
  return [...list.matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
}

function hexToCodes(hex: string, width: number): number[] {
  const codes: number[] = [];
  for (let i = 0; i + width <= hex.length; i += width)
    codes.push(parseInt(hex.slice(i, i + width), 16));
  return codes;
}

function utf16(hex: string): string {
  return String.fromCharCode(...hexToCodes(hex, 4));
}

/** A `ToUnicode` CMap as a glyph-to-text table. */
function parseCMap(source: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of (block[1] ?? '').matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      map.set(parseInt(pair[1] ?? '0', 16), utf16(pair[2] ?? ''));
    }
  }
  for (const block of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1] ?? '';
    for (const range of body.matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/g
    )) {
      const low = parseInt(range[1] ?? '0', 16);
      const high = parseInt(range[2] ?? '0', 16);
      if (range[3] !== undefined) {
        const first = hexToCodes(range[3], 4);
        for (let code = low; code <= high; code += 1) {
          const chars = [...first];
          chars[chars.length - 1] = (chars[chars.length - 1] ?? 0) + (code - low);
          map.set(code, String.fromCharCode(...chars));
        }
      } else {
        const targets = [...(range[4] ?? '').matchAll(/<([0-9a-fA-F]*)>/g)];
        targets.forEach((target, offset) => map.set(low + offset, utf16(target[1] ?? '')));
      }
    }
  }
  return map;
}

/** One printed page: its text runs, in the order they were painted. */
export interface PrintedPage {
  readonly runs: readonly string[];
  /** The runs joined with single spaces and whitespace collapsed. */
  readonly text: string;
}

export function pdfPages(pdf: Buffer): PrintedPage[] {
  const objects = parseObjects(pdf);
  const catalog = [...objects.values()].find((o) => /\/Type \/Catalog/.test(o.dict));
  if (!catalog) throw new Error('the PDF has no catalog');
  const rootPages = ref(catalog.dict, 'Pages');
  if (rootPages === null) throw new Error('the PDF catalog names no page tree');

  const pageIds: number[] = [];
  const walk = (id: number): void => {
    const node = objects.get(id);
    if (!node) throw new Error(`page tree object ${id} is missing`);
    if (/\/Type \/Pages\b/.test(node.dict)) {
      const kids = /\/Kids \[([^\]]*)\]/.exec(node.dict);
      for (const kid of refs(kids?.[1] ?? '')) walk(kid);
    } else {
      pageIds.push(id);
    }
  };
  walk(rootPages);

  const cmaps = new Map<number, Map<number, string>>();
  const cmapOf = (fontId: number): Map<number, string> => {
    const cached = cmaps.get(fontId);
    if (cached) return cached;
    const font = objects.get(fontId);
    const toUnicode = font ? ref(font.dict, 'ToUnicode') : null;
    const stream = toUnicode !== null ? objects.get(toUnicode)?.stream : null;
    if (!stream) throw new Error(`font ${fontId} has no ToUnicode map`);
    const map = parseCMap(stream.toString('latin1'));
    cmaps.set(fontId, map);
    return map;
  };

  return pageIds.map((pageId) => {
    const page = objects.get(pageId);
    if (!page) throw new Error(`page ${pageId} is missing`);
    const fontsBlock = /\/Font <<([^>]*)>>/.exec(page.dict)?.[1] ?? '';
    const fonts = new Map<string, number>();
    for (const entry of fontsBlock.matchAll(/\/(\S+) (\d+) 0 R/g)) {
      fonts.set(entry[1] ?? '', Number(entry[2]));
    }
    const contents = /\/Contents (?:\[([^\]]*)\]|(\d+) 0 R)/.exec(page.dict);
    const contentIds =
      contents?.[1] !== undefined ? refs(contents[1]) : contents?.[2] ? [Number(contents[2])] : [];
    const runs: string[] = [];
    for (const contentId of contentIds) {
      const body = objects.get(contentId)?.stream?.toString('latin1') ?? '';
      let font: Map<number, string> | null = null;
      let run = '';
      const flush = () => {
        if (run.trim() !== '') runs.push(run.replace(/\s+/g, ' ').trim());
        run = '';
      };
      const ops =
        /\/(\S+) [\d.]+ Tf|<([0-9a-fA-F]*)>\s*Tj|\[((?:[^\]]|\\\])*)\]\s*TJ|\b(ET|T\*|Td|TD|Tm)\b/g;
      for (const op of body.matchAll(ops)) {
        if (op[1] !== undefined) {
          const fontId = fonts.get(op[1]);
          font = fontId !== undefined ? cmapOf(fontId) : null;
        } else if (op[2] !== undefined || op[3] !== undefined) {
          if (font === null) throw new Error(`page ${pageId} draws text with no font selected`);
          const strings =
            op[2] !== undefined
              ? [op[2]]
              : [...(op[3] ?? '').matchAll(/<([0-9a-fA-F]*)>/g)].map((m) => m[1] ?? '');
          for (const hex of strings) {
            for (const code of hexToCodes(hex, 4)) run += font.get(code) ?? '';
          }
        } else if (op[4] === 'ET') {
          flush();
        }
      }
      flush();
    }
    return { runs, text: runs.join(' ').replace(/\s+/g, ' ').trim() };
  });
}
