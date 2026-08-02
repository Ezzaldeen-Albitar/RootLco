/**
 * Phase 1-15 unit suite: the deterministic template engine.
 *
 * Nothing here touches a database, a network, or the clock. That is the point:
 * `renderTemplate` is the one place in shared services where administrator-
 * authored markup and untrusted customer text are combined into a string that is
 * then hashed into `outbound_messages.body_sha256` and handed to a transport.
 * Every property pinned below is one that, if it quietly stopped holding, would
 * stay invisible until it had already shipped:
 *
 *  - **Determinism.** If the same content and the same variables could ever
 *    render two different strings, `body_sha256` would stop being an integrity
 *    digest and become a value that merely looks like one.
 *  - **Strictness in both directions.** A placeholder with no value must fail
 *    rather than render "Dear ,", and a value the template never uses must fail
 *    rather than be silently dropped.
 *  - **A single substitution pass.** A value containing `{{other}}` must land as
 *    text and never be re-scanned; re-scanning is how a caller smuggles a
 *    placeholder in through a variable.
 *  - **Escaping applied to values, never to the body.** The body is authored
 *    under `org.settings.manage`; the variables are the untrusted part. Escaping
 *    the body would corrupt the author's markup, and not escaping the values
 *    would put `<script>` into an email.
 *  - **A subject is a header, not content.** CR and LF must be removed outright,
 *    because a subject carrying one splits the header however it is quoted.
 *  - **No reachable filesystem and no reachable module.** A value must never be
 *    able to name a file or a module, so a path-shaped value comes out as inert
 *    text.
 *
 * Every invisible or control character used as test input is built from a
 * `String.fromCharCode`/`\uXXXX` escape, so this source file itself contains no
 * raw control bytes for an editor, a diff, or a copy-paste to silently destroy.
 *
 * Two behaviours worth knowing, pinned here rather than assumed:
 *   1. `RenderOptions.channel` is carried but does not branch the escaping;
 *      `email` and `in_app` render identically today, because both put their
 *      body into markup. The engine's own header says so rather than claiming a
 *      per-channel branch that does not exist.
 *   2. Subject values are stripped and collapsed but NOT HTML-escaped — correct
 *      for an RFC 5322 header, worth knowing for any surface that renders a
 *      subject into markup.
 *
 * This file found one real defect: a placeholder named after an
 * `Object.prototype` member resolved up the prototype chain, slipped past the
 * missing-variable check, and crashed with a `TypeError` — a 500 where a 422
 * belonged. The engine now uses `Object.prototype.hasOwnProperty.call(...)`, and
 * the final test pins both the correct error and the safety property.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalRenderedForm,
  renderTemplate,
  RENDERABLE_CHANNELS,
  templateVariables,
  TemplateRenderError,
  VARIABLE_NAME_PATTERN,
  type RenderedMessage,
  type RenderOptions,
  type TemplateContent,
} from '@/modules/shared-services/domain/template-rendering';
import { API_SRC_ROOT } from '../../scripts/lib/repository-paths.mjs';

const OPTIONS: RenderOptions = { channel: 'email', maxRenderedChars: 10_000 };

/** Invisible, direction-changing and control characters, all built from escapes. */
const NUL = String.fromCharCode(0x00);
const VERTICAL_TAB = String.fromCharCode(0x0b);
const NEXT_LINE = String.fromCharCode(0x85); // C1 NEL: a line break to some parsers.
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const ZERO_WIDTH_NON_JOINER = String.fromCharCode(0x200c);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e);
const LEFT_TO_RIGHT_ISOLATE = String.fromCharCode(0x2066);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/** The escaping the engine applies to a value, restated independently. */
function expectedEscaping(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/**
 * Renders and requires failure, returning the typed error so the `rule` and the
 * reported `names` can both be asserted. A bare `toThrow(/message/)` would pass
 * for any error carrying similar words, including one thrown by the test itself.
 */
function renderFailure(
  content: TemplateContent,
  variables: Readonly<Record<string, string>>,
  options: RenderOptions = OPTIONS
): TemplateRenderError {
  try {
    renderTemplate(content, variables, options);
  } catch (error) {
    if (error instanceof TemplateRenderError) return error;
    throw error;
  }
  throw new Error('renderTemplate returned where a TemplateRenderError was required');
}

describe('determinism', () => {
  it('renders byte-identical output for the same content and the same variables', () => {
    const content: TemplateContent = {
      subject: 'Vehicle {{vehicle}} is ready - {{reference}}',
      body: '<p>Dear {{customer}},</p>\n<p>{{vehicle}} is ready for collection.</p>',
    };
    const variables = {
      customer: `Fatima ${ZERO_WIDTH_SPACE}Nabulsi & Sons`,
      vehicle: 'Toyota Hilux <2019>',
      reference: 'fx_wo_000117',
    };

    const first = renderTemplate(content, variables, OPTIONS);
    const second = renderTemplate(content, { ...variables }, OPTIONS);

    expect(second).toEqual(first);
    // Compared as bytes, not as strings: the digest is taken over bytes, so that
    // is the level the equality claim has to hold at.
    expect(Buffer.from(canonicalRenderedForm(second), 'utf8')).toEqual(
      Buffer.from(canonicalRenderedForm(first), 'utf8')
    );
    expect(sha256(canonicalRenderedForm(second))).toBe(sha256(canonicalRenderedForm(first)));
  });

  it('reports the placeholders it used, sorted, wherever they appear', () => {
    const rendered = renderTemplate(
      { subject: '{{zebra}}', body: 'Hi {{alpha}} - {{zebra}}' },
      { zebra: 'Z', alpha: 'A' },
      OPTIONS
    );
    expect(rendered.usedVariables).toEqual(['alpha', 'zebra']);
    // First-appearance order for discovery, sorted order for the report. Both are
    // stable, which is what makes either one safe to log or to compare.
    expect(templateVariables({ subject: '{{zebra}}', body: 'Hi {{alpha}}' })).toEqual([
      'zebra',
      'alpha',
    ]);
  });

  it('does not leak scanner state between calls', () => {
    // The placeholder pattern is a module-level global regex, so a stale
    // `lastIndex` would make the SECOND scan of a template find less than the
    // first - a defect that only ever appears under repeated use.
    const content: TemplateContent = { subject: 'A {{one}}', body: 'B {{two}} {{one}}' };
    const before = templateVariables(content);
    renderTemplate(content, { one: '1', two: '2' }, OPTIONS);
    expect(templateVariables(content)).toEqual(before);
    expect(templateVariables(content)).toEqual(['one', 'two']);
  });
});

describe('the variable contract is strict in both directions', () => {
  it('refuses a placeholder with no supplied value and names it', () => {
    const failure = renderFailure(
      { subject: 'Hello {{first}}', body: 'Dear {{first}} {{last}},' },
      {}
    );
    expect(failure).toBeInstanceOf(TemplateRenderError);
    expect(failure.name).toBe('TemplateRenderError');
    expect(failure.rule).toBe('missing_variable');
    expect(failure.names).toEqual(['first', 'last']);
  });

  it('names only the placeholders that are actually missing', () => {
    const failure = renderFailure(
      { subject: 'Hello {{first}}', body: 'Dear {{first}} {{last}},' },
      { first: 'Fatima' }
    );
    expect(failure.rule).toBe('missing_variable');
    expect(failure.names).toEqual(['last']);
    // Names only. A value must never travel inside an error that gets logged.
    expect(failure.message).not.toContain('Fatima');
    expect(failure.names).not.toContain('Fatima');
  });

  it('refuses a supplied variable the template does not use', () => {
    const failure = renderFailure(
      { subject: null, body: 'Dear {{first}},' },
      { first: 'Fatima', phone: '+962790000000' }
    );
    expect(failure.rule).toBe('unknown_variable');
    expect(failure.names).toEqual(['phone']);
    expect(failure.message).not.toContain('+962790000000');
  });

  it('refuses a variable name outside the placeholder grammar', () => {
    const badNames = ['first-name', '1leading', 'has.dot', 'has space', '_underscore', ''];
    for (const name of badNames) {
      expect(VARIABLE_NAME_PATTERN.test(name)).toBe(false);
      const failure = renderFailure({ subject: null, body: 'Static body.' }, { [name]: 'x' });
      expect(failure.rule).toBe('invalid_variable_name');
      expect(failure.names).toEqual([name]);
    }
    // The grammar caps the length at 64, so an over-long name is refused by the
    // same rule rather than truncated into a different one.
    const tooLong = 'a'.repeat(65);
    expect(renderFailure({ subject: null, body: 'Static body.' }, { [tooLong]: 'x' }).rule).toBe(
      'invalid_variable_name'
    );
    expect(VARIABLE_NAME_PATTERN.test('a'.repeat(64))).toBe(true);
    expect(VARIABLE_NAME_PATTERN.test('first_name2')).toBe(true);
  });

  it('refuses a non-string value rather than coercing it', () => {
    // An object with a `toString` is the classic way to get unexpected output out
    // of a naive engine. TypeScript forbids this shape, so the cast models a
    // caller arriving from untyped JSON.
    const hostile = { toString: (): string => 'coerced' } as unknown as string;
    const failure = renderFailure({ subject: null, body: 'Hi {{a}}' }, { a: hostile });
    expect(failure.rule).toBe('invalid_variable_value');
    expect(failure.names).toEqual(['a']);
  });

  it('refuses a blank body before anything else', () => {
    for (const body of ['', '   ', '\n\t \n']) {
      // An unknown variable is supplied too: `empty_body` must still win, which
      // is what proves the blank-body check runs first rather than incidentally.
      const failure = renderFailure({ subject: 'Subject', body }, { unknown_extra: 'x' });
      expect(failure.rule).toBe('empty_body');
      expect(failure.names).toEqual([]);
    }
  });

  it('refuses a rendered message over the character ceiling', () => {
    const failure = renderFailure(
      { subject: 'Hi', body: 'x'.repeat(40) },
      {},
      {
        channel: 'email',
        maxRenderedChars: 20,
      }
    );
    expect(failure.rule).toBe('rendered_too_large');
    expect(failure.names).toEqual([]);
    // Subject and body are counted together: 2 + 40.
    expect(failure.message).toContain('42');
    expect(failure.message).toContain('20');
    // Exactly at the ceiling is allowed; it is a maximum, not an exclusive bound.
    const atCeiling = renderTemplate(
      { subject: 'Hi', body: 'x'.repeat(18) },
      {},
      {
        channel: 'email',
        maxRenderedChars: 20,
      }
    );
    expect(atCeiling.body).toHaveLength(18);
  });

  it('measures the RENDERED size, so a long value cannot slip past the ceiling', () => {
    const failure = renderFailure(
      { subject: null, body: '{{note}}' },
      { note: 'y'.repeat(200) },
      { channel: 'email', maxRenderedChars: 50 }
    );
    expect(failure.rule).toBe('rendered_too_large');
    expect(failure.message).toContain('200');
  });
});

describe('escaping applies to values and never to the authored body', () => {
  it('escapes HTML in a value', () => {
    const rendered = renderTemplate(
      { subject: null, body: '<p>{{note}}</p>' },
      { note: `<script>alert("x & 'y')</script>` },
      OPTIONS
    );
    expect(rendered.body).toBe(
      '<p>&lt;script&gt;alert(&quot;x &amp; &#39;y&#39;)&lt;/script&gt;</p>'
    );
    // The ampersand is escaped first, so nothing is double-escaped on the way out.
    expect(rendered.body).not.toContain('&amp;lt;');
    expect(rendered.body).not.toContain('<script');
  });

  it('leaves the administrator-authored markup exactly as written', () => {
    const body =
      '<div class="card" style=\'color:red\'>\n' +
      '  <a href="https://example.test?a=1&b=2">Link</a>\n' +
      '  {{name}}\n' +
      '</div>';
    const rendered = renderTemplate({ subject: null, body }, { name: 'Sami' }, OPTIONS);
    expect(rendered.body).toBe(body.replace('{{name}}', 'Sami'));
    // The author's own ampersand, quotes and angle brackets survive untouched.
    expect(rendered.body).toContain('href="https://example.test?a=1&b=2"');
    expect(rendered.body).toContain("style='color:red'");
    expect(rendered.body).not.toContain('&amp;');
    expect(rendered.body).not.toContain('&lt;');
  });

  it('escapes values on every renderable channel', () => {
    for (const channel of RENDERABLE_CHANNELS) {
      const rendered = renderTemplate(
        { subject: null, body: '{{note}}' },
        { note: '<b>x</b>' },
        { channel, maxRenderedChars: 10_000 }
      );
      expect(rendered.body).toBe('&lt;b&gt;x&lt;/b&gt;');
    }
    // NOTE: `channel` is currently never read by `renderTemplate`. This asserts
    // the escaping that actually happens on both channels - not that the engine
    // branches on the channel, which today it does not.
  });
});

describe('substitution is a single pass', () => {
  it('inserts a value containing a placeholder as text and never re-scans it', () => {
    const rendered = renderTemplate(
      { subject: null, body: 'A {{one}} B {{two}} C' },
      { one: '{{two}}', two: 'SECRET' },
      OPTIONS
    );
    expect(rendered.body).toBe('A {{two}} B SECRET C');
    // The smuggled placeholder stays inert text, so `SECRET` appears exactly once.
    expect(rendered.body.match(/SECRET/g)).toHaveLength(1);
    expect(rendered.usedVariables).toEqual(['one', 'two']);
  });

  it('does not recurse when a value names its own placeholder', () => {
    const rendered = renderTemplate(
      { subject: null, body: 'loop: {{self}}' },
      { self: '{{self}}{{self}}' },
      OPTIONS
    );
    expect(rendered.body).toBe('loop: {{self}}{{self}}');
  });

  it('leaves text that merely resembles a placeholder alone', () => {
    // Nothing outside the one grammar is syntax, so none of these are expansion
    // points and none of them may be supplied as variables. The exception worth
    // knowing about is `{{{x}}}`: the inner `{{x}}` IS a placeholder, and the
    // surrounding braces are ordinary text left on either side of it.
    const content: TemplateContent = {
      subject: null,
      body: '{{a-b}} {{1x}} {{a.b}} {{{x}}} { {ok} } ${ok} <%= ok %> {{#each}} {{ok}}',
    };
    expect(templateVariables(content)).toEqual(['x', 'ok']);
    const rendered = renderTemplate(content, { x: 'X', ok: 'VALUE' }, OPTIONS);
    expect(rendered.body).toBe(
      '{{a-b}} {{1x}} {{a.b}} {X} { {ok} } ${ok} <%= ok %> {{#each}} VALUE'
    );
    // `a.b` never became a placeholder, and it is not a legal variable name
    // either, so trying to supply it fails loudly instead of being a silent no-op.
    expect(renderFailure(content, { x: 'X', ok: 'V', 'a.b': 'no' }).rule).toBe(
      'invalid_variable_name'
    );
  });

  it('accepts internal whitespace in a placeholder without changing its name', () => {
    expect(templateVariables({ subject: null, body: '{{  spaced  }}' })).toEqual(['spaced']);
    expect(
      renderTemplate({ subject: null, body: 'x{{  spaced  }}y' }, { spaced: 'S' }, OPTIONS).body
    ).toBe('xSy');
  });
});

describe('a subject is treated as a header, not as content', () => {
  it('removes CR and LF from a value and collapses the subject to one line', () => {
    const rendered = renderTemplate(
      { subject: 'Job {{ref}} ready', body: 'Body text.' },
      { ref: 'A\r\nBcc: attacker@example.test' },
      OPTIONS
    );
    // Removed outright rather than escaped: the two halves are joined, so there
    // is no second header line left for a transport to interpret.
    expect(rendered.subject).toBe('Job ABcc: attacker@example.test ready');
    expect(rendered.subject).not.toContain('\r');
    expect(rendered.subject).not.toContain('\n');
    expect((rendered.subject ?? '').split('\n')).toHaveLength(1);
  });

  it('removes every line-breaking control a value can carry', () => {
    const rendered = renderTemplate(
      { subject: '[{{ref}}]', body: 'Body text.' },
      {
        ref: `a\rb\nc${VERTICAL_TAB}d${NEXT_LINE}e${LINE_SEPARATOR}f${PARAGRAPH_SEPARATOR}g`,
      },
      OPTIONS
    );
    const subject = rendered.subject ?? '';
    for (const forbidden of ['\r', '\n', VERTICAL_TAB, NEXT_LINE]) {
      expect(subject).not.toContain(forbidden);
    }
    // C0 and C1 controls (CR, LF, VT, NEL) are deleted outright. U+2028 and
    // U+2029 are not controls but they ARE whitespace, so they collapse to a
    // single space instead of vanishing. Either way the subject stays one line.
    expect(subject).toBe('[abcde f g]');
    expect(subject.split(/[\r\n]/)).toHaveLength(1);
  });

  it('collapses whitespace the author put in the subject as well', () => {
    const rendered = renderTemplate(
      { subject: '  Ready:\n   {{ref}}   ', body: 'Body text.' },
      { ref: 'fx_wo_000117' },
      OPTIONS
    );
    expect(rendered.subject).toBe('Ready: fx_wo_000117');
  });

  it('keeps a null subject null', () => {
    const rendered = renderTemplate({ subject: null, body: 'Body {{a}}' }, { a: 'x' }, OPTIONS);
    expect(rendered.subject).toBeNull();
  });

  it('keeps newlines from a value in the body', () => {
    const rendered = renderTemplate(
      { subject: 'One line {{note}}', body: 'Note:\n{{note}}\nEnd' },
      { note: 'line one\nline two\twith a tab' },
      OPTIONS
    );
    expect(rendered.body).toBe('Note:\nline one\nline two\twith a tab\nEnd');
    expect(rendered.body.split('\n')).toHaveLength(4);
    expect(rendered.body).toContain('\t');
    // The SAME value is flattened in the subject and preserved in the body: the
    // difference is the destination, not the value. Note that the subject DELETES
    // the newline and the tab rather than converting them to spaces, so the words
    // on either side are joined ("oneline", "twowith"). Ugly, but a subject is a
    // header: not splitting it matters more than reading well.
    expect(rendered.subject).toBe('One line line oneline twowith a tab');
    expect(rendered.subject).not.toContain('\n');
    expect(rendered.subject).not.toContain('\t');
  });
});

describe('invisible and direction-changing characters are removed from values', () => {
  it('strips zero-width characters and the byte-order mark', () => {
    const rendered = renderTemplate(
      { subject: '{{name}}', body: 'Dear {{name}},' },
      { name: `Ah${ZERO_WIDTH_SPACE}mad${ZERO_WIDTH_NON_JOINER}${BYTE_ORDER_MARK} Nabulsi` },
      OPTIONS
    );
    expect(rendered.body).toBe('Dear Ahmad Nabulsi,');
    expect(rendered.subject).toBe('Ahmad Nabulsi');
    for (const invisible of [ZERO_WIDTH_SPACE, ZERO_WIDTH_NON_JOINER, BYTE_ORDER_MARK]) {
      expect(rendered.body).not.toContain(invisible);
      expect(rendered.subject).not.toContain(invisible);
    }
  });

  it('strips bidirectional overrides and isolates', () => {
    // A bidi override makes the stored string and the displayed string differ,
    // which is how one recipient's name is made to display as another's.
    const spoofed = `invoice${RIGHT_TO_LEFT_OVERRIDE}fdp.exe${LEFT_TO_RIGHT_ISOLATE}`;
    const rendered = renderTemplate(
      { subject: '{{file}}', body: 'Attached: {{file}}' },
      { file: spoofed },
      OPTIONS
    );
    expect(rendered.body).toBe('Attached: invoicefdp.exe');
    expect(rendered.subject).toBe('invoicefdp.exe');
    expect(rendered.body).not.toContain(RIGHT_TO_LEFT_OVERRIDE);
    expect(rendered.body).not.toContain(LEFT_TO_RIGHT_ISOLATE);
    // The stored value and the rendered value now agree on their character count.
    expect(rendered.body).toHaveLength('Attached: invoicefdp.exe'.length);
  });

  it('strips NUL from a value so it cannot forge the canonical separator', () => {
    // `canonicalRenderedForm` separates subject from body with NUL. A value able
    // to carry one could move the boundary the digest depends on.
    const rendered = renderTemplate(
      { subject: '{{a}}', body: `x{{a}}y` },
      { a: `p${NUL}q` },
      OPTIONS
    );
    expect(rendered.body).toBe('xpqy');
    expect(rendered.body).not.toContain(NUL);
    expect(canonicalRenderedForm(rendered).split(NUL)).toHaveLength(2);
  });
});

describe('templateVariables', () => {
  it('finds every distinct placeholder in the subject and the body', () => {
    const found = templateVariables({
      subject: 'Ref {{reference}} for {{customer}}',
      body: 'Dear {{customer}}, your {{vehicle}} ({{reference}}) is ready. - {{advisor}}',
    });
    expect(found).toEqual(['reference', 'customer', 'vehicle', 'advisor']);
    expect(new Set(found).size).toBe(found.length);
  });

  it('handles a null subject and a template with no placeholders', () => {
    expect(templateVariables({ subject: null, body: 'Static body.' })).toEqual([]);
    expect(templateVariables({ subject: null, body: '{{only_in_body}}' })).toEqual([
      'only_in_body',
    ]);
    expect(templateVariables({ subject: '{{only_in_subject}}', body: 'Static.' })).toEqual([
      'only_in_subject',
    ]);
  });

  it('agrees with the render contract about what a template requires', () => {
    const content: TemplateContent = { subject: '{{a}}', body: '{{b}} {{a}}' };
    const required = templateVariables(content);
    const variables = Object.fromEntries(required.map((name) => [name, name.toUpperCase()]));
    // Supplying exactly what discovery reports is accepted; one fewer is
    // `missing_variable` and one more is `unknown_variable`.
    expect(renderTemplate(content, variables, OPTIONS).usedVariables).toEqual([...required].sort());
    expect(renderFailure(content, { a: 'A' }).rule).toBe('missing_variable');
    expect(renderFailure(content, { ...variables, c: 'C' }).rule).toBe('unknown_variable');
  });
});

describe('canonicalRenderedForm', () => {
  it('distinguishes messages that plain concatenation would collide', () => {
    const left = canonicalRenderedForm({ subject: 'ab', body: 'c', usedVariables: [] });
    const right = canonicalRenderedForm({ subject: 'a', body: 'bc', usedVariables: [] });
    expect(left).toBe(`ab${NUL}c`);
    expect(right).toBe(`a${NUL}bc`);
    expect(left).not.toBe(right);
    // Concatenated without the separator they would be the same three characters,
    // and the digest would stop telling two different messages apart.
    expect(left.replace(NUL, '')).toBe(right.replace(NUL, ''));
    expect(sha256(left)).not.toBe(sha256(right));
  });

  it('depends only on the delivered text, not on usedVariables', () => {
    expect(canonicalRenderedForm({ subject: 's', body: 'b', usedVariables: ['x'] })).toBe(
      canonicalRenderedForm({ subject: 's', body: 'b', usedVariables: [] })
    );
  });

  it('renders a null subject as an empty prefix', () => {
    expect(canonicalRenderedForm({ subject: null, body: 'b', usedVariables: [] })).toBe(`${NUL}b`);
    // NOTE: a null subject and an empty-string subject canonicalise identically.
    // Recorded, not asserted as desirable - `renderTemplate` never turns a null
    // subject into an empty string, so the two do not collide in practice.
  });
});

describe('no filesystem path and no module is reachable through a value', () => {
  it('renders a traversal path as inert text', () => {
    const rendered = renderTemplate(
      { subject: null, body: 'File: {{path}}' },
      { path: '../../../etc/passwd' },
      OPTIONS
    );
    expect(rendered.body).toBe('File: ../../../etc/passwd');
  });

  it('does not read a real, existing file named by a value', () => {
    // The strongest behavioural proof available without mocking the runtime: name
    // a file that genuinely exists and whose content is known, then require that
    // none of that content appears and the path comes back verbatim.
    const realPath = join(process.cwd(), 'package.json');
    const realContent = readFileSync(realPath, 'utf8');
    expect(realContent).toContain('"scripts"');

    const rendered = renderTemplate(
      { subject: null, body: 'Attachment: {{path}}' },
      { path: realPath },
      OPTIONS
    );
    expect(rendered.body).toBe(`Attachment: ${realPath}`);
    expect(rendered.body).not.toContain('"scripts"');
    expect(rendered.body).not.toContain('"devDependencies"');
    expect(rendered.body.length).toBeLessThan(realContent.length);
  });

  it('renders module and expression syntax as inert text', () => {
    const hostile = [
      `require('node:fs').readFileSync('/etc/passwd')`,
      `import('node:child_process')`,
      '${process.env.DB_PASSWORD}',
      '<%= system("id") %>',
      '{{#include "/etc/passwd"}}',
      '{{lookup . "constructor"}}',
      'file:///etc/shadow',
      'C:\\Windows\\win.ini',
    ];
    for (const value of hostile) {
      const rendered = renderTemplate({ subject: null, body: '[{{v}}]' }, { v: value }, OPTIONS);
      // Only HTML-significant characters change. Nothing is evaluated, expanded
      // or resolved, so the output is the input plus escaping and nothing else.
      expect(rendered.body).toBe(`[${expectedEscaping(value)}]`);
      expect(rendered.body).not.toContain('root:');
      expect(rendered.body).not.toContain('uid=');
    }
  });

  it('has no import, require, eval or Function in the engine source', () => {
    // Supplementary structural guard rather than a behavioural one: the module
    // imports nothing at all, so no filesystem or module API is even in scope for
    // a later edit to reach by accident.
    const source = readFileSync(
      join(API_SRC_ROOT, 'modules', 'shared-services', 'domain', 'template-rendering.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\beval\s*\(/);
    expect(source).not.toMatch(/new\s+Function\s*\(/);
  });

  it('reports a placeholder named after an Object.prototype member as missing', () => {
    // `variables` is a plain object, so `variables['constructor']` resolves up
    // the prototype chain to a *function* rather than to `undefined`. A naive
    // `variables[name] === undefined` check therefore passes it through, and the
    // inherited function reaches the string handling and throws a `TypeError` —
    // an administrator-authored template using one of these names would turn a
    // clean 422 into a 500.
    //
    // This test found that defect; the engine now uses
    // `Object.prototype.hasOwnProperty.call(...)`, so the refusal is the correct
    // cataloged one. Both halves are pinned: the right error type, AND the
    // safety property that nothing inherited is ever rendered.
    for (const inherited of [
      'constructor',
      'toString',
      'valueOf',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable',
      'toLocaleString',
    ]) {
      const failure = renderFailure({ subject: null, body: `Hi {{${inherited}}}` }, {});
      expect(failure.rule, inherited).toBe('missing_variable');
      expect(failure.names, inherited).toEqual([inherited]);
    }

    // Supplying the name as an OWN property is ordinary and must still work — the
    // fix must not have made these names unusable, only unsafe-by-inheritance.
    const rendered: RenderedMessage = renderTemplate(
      { subject: null, body: 'Hi {{constructor}}' },
      { constructor: 'Ada' },
      OPTIONS
    );
    expect(rendered.body).toBe('Hi Ada');
  });
});

// ===========================================================================
// P1-15-SR-009 and P1-15-SR-011 — bounds and invisibles, found by the final
// adversarial pass and fixed before merge.
// ===========================================================================

describe('the rendered-size ceiling bounds the WORK, not only the result (P1-15-SR-009)', () => {
  it('refuses before building a string it would only throw away', () => {
    // Substitution is multiplicative: one placeholder repeated N times expands
    // to N copies of the value. Two kilobytes of template and two kilobytes of
    // value used to allocate ~4 MB, measure it, and reject it — and the same
    // shape at realistic sizes allocated hundreds of megabytes before failing.
    const body = '{{v}}'.repeat(2_000);
    const variables = { v: 'x'.repeat(2_000) };

    const failure = renderFailure({ subject: null, body }, variables);
    expect(failure.rule).toBe('rendered_too_large');
    // The message states the PROJECTED size, which is what makes it possible to
    // tell the refusal happened before the allocation rather than after it.
    expect(failure.message).toContain('would be');
  });

  it('projects the size exactly, so a template just under the ceiling still renders', () => {
    // 100 occurrences of a 90-character value plus 10 characters of literal text
    // is 9 010 characters — under the 10 000 ceiling. An estimate that rounded
    // up would refuse this; the projection must not.
    const body = '0123456789' + '{{v}}'.repeat(100);
    const rendered = renderTemplate({ subject: null, body }, { v: 'y'.repeat(90) }, OPTIONS);
    expect(rendered.body.length).toBe(10 + 100 * 90);
  });

  it('counts the subject too, because the ceiling is the whole message', () => {
    const failure = renderFailure({ subject: '{{v}}', body: '{{v}}' }, { v: 'z'.repeat(9_000) });
    expect(failure.rule).toBe('rendered_too_large');
  });
});

describe('invisible direction marks are stripped from values (P1-15-SR-011)', () => {
  const ARABIC_LETTER_MARK = String.fromCharCode(0x061c);
  const WORD_JOINER = String.fromCharCode(0x2060);

  it('removes U+061C ARABIC LETTER MARK, which matters most in this product', () => {
    const rendered = renderTemplate(
      { subject: 'Hi {{name}}', body: 'Hi {{name}}' },
      { name: `A${ARABIC_LETTER_MARK}B` },
      OPTIONS
    );
    expect(rendered.body).not.toContain(ARABIC_LETTER_MARK);
    expect(rendered.subject).not.toContain(ARABIC_LETTER_MARK);
    expect(rendered.body).toBe('Hi AB');
  });

  it('removes U+2060 WORD JOINER, the other survivor of the original ranges', () => {
    const rendered = renderTemplate(
      { subject: null, body: 'Hi {{name}}' },
      { name: `A${WORD_JOINER}B` },
      OPTIONS
    );
    expect(rendered.body).toBe('Hi AB');
  });

  it('still keeps ordinary Arabic text intact — the strip is of invisibles only', () => {
    const rendered = renderTemplate(
      { subject: null, body: 'Hi {{name}}' },
      { name: 'محمد' },
      OPTIONS
    );
    expect(rendered.body).toBe('Hi محمد');
  });
});
