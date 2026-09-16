#!/usr/bin/env node
/**
 * Builds the printed manual.
 *
 * Reads every Markdown file in `docs/user-manual/` in reading order, renders it
 * with the converter beside this file, assembles ONE HTML document with a
 * generated table of contents, and prints it to PDF with the Chromium that
 * Playwright installs. It then prints the quick start on its own.
 *
 * Nothing is written inside the repository: the HTML and both PDFs go to the
 * directory named by `UM_OUT_DIR`. Images stay relative (`images/…`) in the
 * HTML and resolve through a `<base>` element pointing at the manual directory,
 * so the repository keeps one copy of every screenshot.
 *
 * Usage (from anywhere):
 *   UM_OUT_DIR=<output directory> node docs/user-manual/tools/build-pdf.mjs
 *
 * Optional:
 *   UM_CHROMIUM  path to a Chromium executable, if Playwright's own registry
 *                does not resolve one on this machine.
 *
 * Exit codes: 0 built, 2 bad invocation or environment, 1 leftover Markdown in
 * the rendered HTML (which means the converter met a construct it does not
 * understand, and the output must not be shipped).
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { renderMarkdown, splitFrontMatter } from './markdown-to-html.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANUAL = resolve(HERE, '..');
const REPO = resolve(MANUAL, '..', '..');

/** Reading order. The front page first, then the parts, then the quick start. */
const ORDER = [
  'README.md',
  '01-access-and-account-recovery.md',
  '02-saas-and-organisation-administration.md',
  '03-users-and-permissions.md',
  '04a-customers-vehicles-appointments-reception.md',
  '04b-work-orders-diagnostics-technicians-quality.md',
  '04c-services-quotations-execution-parts.md',
  '04d-delivery-and-warranty.md',
  '05-inventory.md',
  '06-finance-and-reporting.md',
  '07-daily-operation-and-troubleshooting.md',
  'first-login-and-first-working-day.md',
];
const QUICK_START = 'first-login-and-first-working-day.md';

const outDir = process.env.UM_OUT_DIR;
if (!outDir) {
  console.error(
    'UM_OUT_DIR is not set. Point it at a directory OUTSIDE this repository, for example:\n' +
      '  UM_OUT_DIR=../handover node docs/user-manual/tools/build-pdf.mjs'
  );
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

/* ------------------------------------------------------------------ pages */

const CSS = `
@page { size: A4; margin: 18mm 16mm 20mm 16mm; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  font-family: "Segoe UI", "Noto Sans", Arial, sans-serif;
  font-size: 10pt; line-height: 1.5; color: #1a1a1a; margin: 0;
}
.ar { font-family: "Segoe UI", "Noto Naskh Arabic", "Traditional Arabic", serif; unicode-bidi: isolate; }
h1 { font-size: 20pt; line-height: 1.25; margin: 0 0 8pt; page-break-before: always; page-break-after: avoid; }
h1.first { page-break-before: avoid; }
h2 { font-size: 14pt; margin: 16pt 0 6pt; page-break-after: avoid; border-block-end: 0.6pt solid #c8c8c8; padding-block-end: 2pt; }
h3 { font-size: 11.5pt; margin: 12pt 0 4pt; page-break-after: avoid; }
h4 { font-size: 10.5pt; margin: 10pt 0 3pt; page-break-after: avoid; }
p { margin: 0 0 6pt; orphans: 2; widows: 2; }
ul, ol { margin: 0 0 6pt; padding-inline-start: 18pt; }
li { margin: 0 0 2pt; }
code { font-family: "Cascadia Mono", Consolas, "Courier New", monospace; font-size: 8.8pt; background: #f2f2f2; padding: 0 2px; border-radius: 2px; }
pre { background: #f5f5f5; border: 0.5pt solid #ddd; padding: 6pt; overflow-wrap: anywhere; white-space: pre-wrap; page-break-inside: avoid; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 0 0 8pt; font-size: 8.6pt; page-break-inside: auto; }
th, td { border: 0.5pt solid #bbb; padding: 3pt 4pt; text-align: start; vertical-align: top; }
th { background: #eef1f4; font-weight: 600; }
tr { page-break-inside: avoid; }
blockquote { margin: 0 0 8pt; padding-inline-start: 10pt; border-inline-start: 2pt solid #bcc6d0; color: #333; }
img { max-width: 100%; height: auto; border: 0.5pt solid #ccc; page-break-inside: avoid; }
hr { border: none; border-block-start: 0.5pt solid #d8d8d8; margin: 10pt 0; }
a { color: #14425f; text-decoration: none; }
.cover { page-break-after: always; padding-block-start: 40mm; }
.cover h1 { font-size: 30pt; border: none; page-break-before: avoid; }
.cover dl { margin-block-start: 16pt; font-size: 11pt; }
.cover dt { font-weight: 600; margin-block-start: 8pt; }
.cover dd { margin: 0 0 0 0; }
.toc { page-break-after: always; }
.toc h1 { page-break-before: avoid; }
.toc ol { list-style: none; padding-inline-start: 0; }
.toc .l2 { padding-inline-start: 14pt; font-size: 9.2pt; }
.toc .l1 { margin-block-start: 6pt; font-weight: 600; }
.part-meta { font-size: 8.6pt; color: #555; margin: 0 0 10pt; }
`;

const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function buildDocument(files, { cover, withToc }) {
  const rendered = files.map((name, index) => {
    const source = readFileSync(join(MANUAL, name), 'utf8');
    const { meta } = splitFrontMatter(source);
    const r = renderMarkdown(source, { idPrefix: `f${index}-` });
    return { name, meta, ...r };
  });

  const meta = rendered[0].meta;
  const version = meta.application_version ?? '';
  const shortVersion = meta.application_version_short ?? version.slice(0, 8);
  const environment = meta.environment ?? '';

  const toc = withToc
    ? `<section class="toc"><h1 class="first">Contents</h1><ol>${rendered
        .flatMap((doc) =>
          doc.headings
            .filter((h) => h.level <= 2)
            .map((h) => `<li class="l${h.level}"><a href="#${h.id}">${escape(h.text)}</a></li>`)
        )
        .join('')}</ol></section>`
    : '';

  const bodies = rendered
    .map(
      (doc, index) =>
        `<section class="part">${doc.html.replace(
          /^<h1 /,
          index === 0 && !cover ? '<h1 class="first" ' : '<h1 '
        )}</section>`
    )
    .join('\n');

  const coverHtml = cover
    ? `<section class="cover">
<h1>${escape(cover.title)}</h1>
<dl>
<dt>Application version</dt><dd><code>${escape(version)}</code> (short form <code>${escape(shortVersion)}</code>)</dd>
<dt>Environment</dt><dd>${escape(environment)}</dd>
<dt>Date</dt><dd>${escape(meta.date ?? '')}</dd>
<dt>Scope</dt><dd>${escape(meta.scope_statement ?? '')}</dd>
</dl>
</section>`
    : '';

  const html = `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8" />
<title>${escape(cover ? cover.title : (rendered[0].meta.title ?? 'Manual'))}</title>
<base href="${pathToFileURL(MANUAL + '/').href}" />
<style>${CSS}</style>
</head>
<body>
${coverHtml}
${toc}
${bodies}
</body>
</html>
`;
  return { html, version, shortVersion, environment };
}

/** A construct the converter did not understand shows up as visible Markdown. */
function leftoverMarkdown(html) {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<code[\s\S]*?<\/code>/g, '')
    .replace(/<pre[\s\S]*?<\/pre>/g, '')
    .replace(/<[^>]+>/g, ' ');
  const findings = [];
  const probes = [
    ['unrendered heading', /(^|\s)#{1,6}\s+\S/],
    ['unrendered bold', /\*\*\S/],
    ['unrendered link', /\[[^\]]+\]\([^)\s]+\)/],
    ['unrendered image', /!\[[^\]]*\]\(/],
    ['unrendered table row', /^\s*\|.*\|\s*$/m],
    ['html comment survived', /<!--/],
  ];
  for (const [name, re] of probes) if (re.test(text)) findings.push(name);
  return findings;
}

/* --------------------------------------------------------------- printing */

const require_ = createRequire(join(REPO, 'package.json'));
let chromium;
try {
  ({ chromium } = require_('playwright-core'));
} catch {
  console.error('playwright-core is not installed in this repository; cannot render a PDF.');
  process.exit(2);
}

const headerFor = (version, environment) =>
  `<div style="font-size:7pt;color:#666;width:100%;padding:0 16mm;display:flex;justify-content:space-between;">
<span>CRM User Manual &mdash; version ${version}</span><span>${environment}</span></div>`;

const FOOTER = `<div style="font-size:7pt;color:#666;width:100%;padding:0 16mm;text-align:center;">
Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`;

async function print(browser, { html, version, environment }, htmlPath, pdfPath) {
  writeFileSync(htmlPath, html, 'utf8');
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: headerFor(version, environment),
    footerTemplate: FOOTER,
    margin: { top: '20mm', bottom: '16mm', left: '14mm', right: '14mm' },
  });
  await page.close();
}

const present = readdirSync(MANUAL).filter((f) => f.endsWith('.md'));
const missing = ORDER.filter((f) => !present.includes(f));
const unlisted = present.filter((f) => !ORDER.includes(f));
if (missing.length || unlisted.length) {
  console.error(
    `reading order does not match the directory: missing ${missing}, unlisted ${unlisted}`
  );
  process.exit(2);
}

const full = buildDocument(ORDER, {
  cover: { title: 'CRM User Manual' },
  withToc: true,
});
const quick = buildDocument([QUICK_START], {
  cover: { title: 'CRM — First login and first working day' },
  withToc: false,
});

for (const [name, doc] of [
  ['full manual', full],
  ['quick start', quick],
]) {
  const findings = leftoverMarkdown(doc.html);
  if (findings.length) {
    console.error(`FAIL ${name}: leftover Markdown in the rendered HTML — ${findings.join(', ')}`);
    process.exit(1);
  }
}

const short = full.shortVersion;
const targets = [
  [
    'full manual',
    full,
    join(outDir, `RootLco-User-Manual-${short}.html`),
    join(outDir, `RootLco-User-Manual-${short}.pdf`),
  ],
  [
    'quick start',
    quick,
    join(outDir, `RootLco-First-Login-and-First-Working-Day-${short}.html`),
    join(outDir, `RootLco-First-Login-and-First-Working-Day-${short}.pdf`),
  ],
];

const browser = await chromium.launch(
  process.env.UM_CHROMIUM ? { executablePath: process.env.UM_CHROMIUM } : {}
);
try {
  for (const [name, doc, htmlPath, pdfPath] of targets) {
    await print(browser, doc, htmlPath, pdfPath);
    console.log(`${name}: ${pdfPath} (${statSync(pdfPath).size} bytes)`);
  }
} finally {
  await browser.close();
}
console.log('built from HTML by Chromium; the text layer is real text, not an image');
