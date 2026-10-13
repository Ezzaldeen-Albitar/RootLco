# Building the printed manual

`build-pdf.mjs` renders every Markdown file in `docs/user-manual/` into one HTML document and
prints it to PDF with the Chromium that Playwright installs for this repository. It also prints the
quick start on its own. `markdown-to-html.mjs` is the converter it uses — a small, dependency-free
renderer for exactly the Markdown subset this manual uses, written because no Markdown renderer is
installed here.

## Run it

From the repository root:

```
UM_OUT_DIR=<a directory outside this repository> node docs/user-manual/tools/build-pdf.mjs
```

On Windows PowerShell:

```
$env:UM_OUT_DIR = '<a directory outside this repository>'
node docs/user-manual/tools/build-pdf.mjs
```

`UM_OUT_DIR` is required and has no default, so the build can never write its output into the
repository. Set `UM_CHROMIUM` to a Chromium executable if Playwright's own browser registry does
not resolve one on the machine you are building on.

## What it produces

In `UM_OUT_DIR`:

- `RootLco-User-Manual-<short version>.pdf` — the whole manual, in reading order: the front page,
  Parts 1 to 7, then the quick start, with a cover page and a generated table of contents.
- `RootLco-First-Login-and-First-Working-Day-<short version>.pdf` — the quick start alone.
- The intermediate HTML for each, kept so a rendering question can be answered without a rerun.

The short version comes from the `application_version_short` field in the front matter of
`README.md`, so the file names follow the manual rather than the build machine.

## What it guarantees

- **A4 with margins**, page numbers in the footer, and the application version and the environment
  in the header of every page.
- **Text, not pictures.** The PDF is printed from HTML by Chromium, so every word in it is real
  text and the document is searchable by construction.
- **Images by relative path.** Screenshots stay as `images/…` in the HTML and resolve through a
  `<base>` element pointing at the manual directory, so the repository keeps exactly one copy of
  each capture.
- **Right-to-left where the manual shows Arabic.** Every run of Arabic script is wrapped in an
  isolating right-to-left span, so an Arabic label inside an English sentence does not drag the
  surrounding punctuation with it.
- **No silent loss.** Before printing, the build scans its own HTML for Markdown that survived the
  conversion — an unrendered heading, table row, link, image, bold run or HTML comment — and exits
  non-zero rather than shipping a document with a construct the converter did not understand.

## What it is not

It is not a general Markdown renderer. It understands front matter, HTML comments, ATX headings,
paragraphs, bold, italic, code spans, fenced code blocks, links, images, ordered and unordered
lists with nesting, tables, block quotes and horizontal rules. Anything else will be caught by the
leftover-syntax check rather than rendered, and the right response is to extend the converter, not
to reword the manual.

The PDFs are deliverables, not repository content. Nothing under `UM_OUT_DIR` is committed.
