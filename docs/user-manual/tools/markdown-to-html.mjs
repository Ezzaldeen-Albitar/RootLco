#!/usr/bin/env node
/**
 * A small, deterministic Markdown-to-HTML converter for this manual.
 *
 * It exists because no Markdown renderer is installed in this repository and the
 * manual must be rebuildable without adding a dependency. It covers exactly the
 * subset the manual uses and nothing else:
 *
 *   YAML front matter (removed), HTML comments (removed), ATX headings,
 *   paragraphs, bold, italic, code spans, fenced code blocks, links, images,
 *   ordered and unordered lists with one level of nesting, tables, block quotes
 *   and horizontal rules.
 *
 * Anything outside that subset is left as literal text, which is why
 * `build-pdf.mjs` runs a leftover-syntax check over its own output: a construct
 * this file does not understand shows up as visible Markdown rather than as
 * silently dropped content.
 *
 * It renders nothing from the network and reads nothing but the files it is
 * given.
 */

/** Characters that must not reach the browser as markup. */
const escapeHtml = (s) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Any run of Arabic script, so it can be isolated as right-to-left. */
const ARABIC_RUN = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿](?:[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿\s،؛؟.,:()/-]*[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿])?/g;

/**
 * Wraps every Arabic run in an isolating right-to-left span.
 *
 * The document is left-to-right. Without isolation an Arabic label sitting in an
 * English sentence drags the neighbouring punctuation with it, which is the
 * single most common way a bilingual page prints wrongly.
 */
const isolateArabic = (html) =>
  html.replace(ARABIC_RUN, (run) => `<span lang="ar" dir="rtl" class="ar">${run}</span>`);

/** Inline markup, applied to one line of already-block-classified text. */
export function inline(text) {
  const codes = [];
  // 1. Code spans are literal: take them out before anything else runs.
  let work = text.replace(/`([^`]+)`/g, (_, body) => {
    codes.push(escapeHtml(body));
    return `@@UMCODE7F3A${codes.length - 1}@@`;
  });

  // 2. Everything that remains is text until this converter says otherwise.
  work = escapeHtml(work);

  // 3. Images before links: the syntaxes differ by one leading character.
  work = work.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_, alt, src) => `<img src="${src}" alt="${alt}" />`
  );
  work = work.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, label, href) => `<a href="${href}">${label}</a>`
  );

  // 4. Emphasis. Bold first, so the italic rule cannot eat half of a bold run.
  work = work.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  work = work.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  work = work.replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');

  // 5. Put the code spans back.
  work = work.replace(/@@UMCODE7F3A(\d+)@@/g, (_, i) => `<code>${codes[Number(i)]}</code>`);

  return isolateArabic(work);
}

/** A stable, readable anchor for a heading. */
export function slugify(text) {
  return (
    text
      .toLowerCase()
      .replace(/[`*_[\]()]/g, '')
      .replace(/[^a-z0-9؀-ۿ]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

/** Removes YAML front matter and returns it parsed as flat key/value strings. */
export function splitFrontMatter(source) {
  if (!source.startsWith('---\n')) return { meta: {}, body: source };
  const end = source.indexOf('\n---', 4);
  if (end === -1) return { meta: {}, body: source };
  const block = source.slice(4, end);
  const body = source.slice(end + 4).replace(/^\n/, '');
  const meta = {};
  for (const line of block.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (/^'.*'$/.test(value)) value = value.slice(1, -1).replaceAll("''", "'");
    else if (/^".*"$/.test(value)) value = value.slice(1, -1);
    meta[m[1]] = value;
  }
  return { meta, body };
}

/** Blanks HTML comments, preserving line breaks so line-oriented parsing holds. */
const stripComments = (source) =>
  source.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''));

const isTableDelimiter = (line) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');

const splitRow = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/**
 * Renders one document.
 *
 * @param {string} source raw Markdown
 * @param {{idPrefix?: string, headingOffset?: number}} options
 * @returns {{html: string, headings: {level: number, text: string, id: string}[], meta: Record<string,string>}}
 */
export function renderMarkdown(source, options = {}) {
  const idPrefix = options.idPrefix ?? '';
  const offset = options.headingOffset ?? 0;
  const { meta, body } = splitFrontMatter(source);
  const lines = stripComments(body).split('\n');

  const out = [];
  const headings = [];
  const seen = new Set();
  let i = 0;

  const uniqueId = (text) => {
    const base = `${idPrefix}${slugify(text)}`;
    let id = base;
    let n = 2;
    while (seen.has(id)) id = `${base}-${n++}`;
    seen.add(id);
    return id;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Fenced code block
    if (/^\s*```/.test(line)) {
      const buf = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // Horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr />');
      i += 1;
      continue;
    }

    // Heading
    const head = /^(#{1,6})\s+(.*)$/.exec(line);
    if (head) {
      const level = Math.min(6, head[1].length + offset);
      const text = head[2].trim();
      const id = uniqueId(text);
      headings.push({ level: head[1].length, text, id });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i += 1;
      continue;
    }

    // Table
    if (line.includes('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      const head2 = header.map((c) => `<th>${inline(c)}</th>`).join('');
      const bodyRows = rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('');
      out.push(`<table><thead><tr>${head2}</tr></thead><tbody>${bodyRows}</tbody></table>`);
      continue;
    }

    // Block quote
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      const nested = renderMarkdown(buf.join('\n'), {
        idPrefix: `${idPrefix}q-`,
        headingOffset: offset,
      });
      out.push(`<blockquote>${nested.html}</blockquote>`);
      continue;
    }

    // List (ordered or unordered), one level of nesting
    const listStart = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (listStart) {
      const { html, next } = readList(lines, i, idPrefix, offset);
      out.push(html);
      i = next;
      continue;
    }

    // Paragraph: consecutive non-blank lines that start no other block
    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^(\s*)([-*+]|\d+\.)\s+/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1]))
    ) {
      buf.push(lines[i].trim());
      i += 1;
    }
    if (buf.length) out.push(`<p>${inline(buf.join(' '))}</p>`);
    else i += 1;
  }

  return { html: out.join('\n'), headings, meta };
}

/** Reads one list (and its nested children) starting at `start`. */
function readList(lines, start, idPrefix, offset) {
  const first = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[start]);
  const baseIndent = first[1].length;
  const ordered = /\d+\./.test(first[2]);
  const items = [];
  let i = start;

  while (i < lines.length) {
    const m = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i]);
    if (!m || m[1].length < baseIndent) break;
    if (m[1].length > baseIndent) {
      // nested list: hand it to a recursive read and attach to the last item
      const { html, next } = readList(lines, i, idPrefix, offset);
      if (items.length) items[items.length - 1].children.push(html);
      i = next;
      continue;
    }
    if (ordered !== /\d+\./.test(m[2])) break;

    const text = [m[3]];
    i += 1;
    // continuation lines: indented, not a new item, not blank
    while (i < lines.length) {
      if (lines[i].trim() === '') {
        // a blank line ends the item unless the next line continues it
        const after = lines[i + 1] ?? '';
        const continues =
          /^(\s*)([-*+]|\d+\.)\s+/.test(after) &&
          (/^(\s*)/.exec(after)[1].length ?? 0) >= baseIndent;
        if (!continues) break;
        i += 1;
        continue;
      }
      if (/^(\s*)([-*+]|\d+\.)\s+/.test(lines[i])) break;
      const indent = /^(\s*)/.exec(lines[i])[1].length;
      if (indent <= baseIndent && baseIndent === 0 && indent === 0) break;
      if (indent < baseIndent + 1) break;
      text.push(lines[i].trim());
      i += 1;
    }
    items.push({ text: text.join(' '), children: [] });
  }

  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && first[2] !== '1.' ? ` start="${parseInt(first[2], 10)}"` : '';
  const html = `<${tag}${startAttr}>${items
    .map((it) => `<li>${inline(it.text)}${it.children.join('')}</li>`)
    .join('')}</${tag}>`;
  return { html, next: i };
}
