/**
 * Deterministic template rendering (P1-15).
 *
 * A template engine is a code-execution surface unless it is deliberately made
 * not to be. This one is made not to be, by omission rather than by filtering:
 *
 *  - the only syntax is `{{name}}`. There are no expressions, no conditionals,
 *    no loops, no partials, no includes, no helpers, and no filters, so there is
 *    nothing to inject *into*;
 *  - nothing is read from the filesystem and nothing is imported, so a value
 *    cannot select a file or a module;
 *  - substitution is a single pass over the template. A value that happens to
 *    contain `{{other}}` is inserted as text and is never re-scanned, which is
 *    what stops a caller from smuggling a placeholder through a variable.
 *
 * Given the same version content and the same variables, the output is byte-for-
 * byte identical — which is what makes `outbound_messages.body_sha256` a usable
 * integrity digest rather than a decoration.
 *
 * ## The body is not the untrusted part; the variables are
 *
 * The template body is authored by an administrator holding
 * `org.settings.manage`. The **variables** are the untrusted part: they carry
 * customer names, vehicle descriptions, and free text. So values are escaped and
 * the body is not — escaping the body would corrupt the markup the author wrote.
 *
 * `subject` is treated as a header, not as content: CR and LF are removed
 * outright rather than escaped, because a subject line that contains one splits
 * the header no matter how it is quoted.
 *
 * **Escaping does not currently branch on channel, and this file does not claim
 * it does.** `RenderOptions.channel` is carried because callers and metrics need
 * it and because a future channel may need different escaping — but both
 * channels the database accepts (`email`, `in_app`) render their body into
 * markup, so both get the same HTML escaping today. A channel that needs
 * something else must add the branch and the test that proves it; until then,
 * saying "escaping is per channel" would describe a branch that does not exist.
 */

/** Placeholder name grammar. Deliberately narrow — no dots, no indexing. */
export const VARIABLE_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

/** The one piece of syntax this engine has. */
const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]{0,63})\s*\}\}/g;

/** Channels the database accepts (`ck_message_templates_channel`). */
export const RENDERABLE_CHANNELS = ['email', 'in_app'] as const;
export type RenderableChannel = (typeof RENDERABLE_CHANNELS)[number];

export class TemplateRenderError extends Error {
  public override readonly name = 'TemplateRenderError';
  constructor(
    message: string,
    /** Stable machine code, safe to return as a validation `rule`. */
    public readonly rule:
      | 'missing_variable'
      | 'unknown_variable'
      | 'invalid_variable_name'
      | 'invalid_variable_value'
      | 'rendered_too_large'
      | 'empty_body',
    /** Placeholder names involved. Names only — never values. */
    public readonly names: readonly string[] = []
  ) {
    super(message);
  }
}

export interface TemplateContent {
  /** Optional subject. Rendered as a header-safe single line. */
  readonly subject: string | null;
  readonly body: string;
}

export interface RenderedMessage {
  readonly subject: string | null;
  readonly body: string;
  /** Placeholder names the template actually used, sorted. Safe to log. */
  readonly usedVariables: readonly string[];
}

export interface RenderOptions {
  readonly channel: RenderableChannel;
  /** Ceiling on subject + body, in characters. */
  readonly maxRenderedChars: number;
}

/** HTML-escapes a value. Applied to variables, never to the authored body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Removes characters that are invisible or structurally dangerous in a value.
 *
 * Keeps `\n` and `\t` for bodies. Strips C0/C1 controls, zero-width characters,
 * and bidirectional overrides: a bidi override in a customer name renders as a
 * different string than it stores, which is how one recipient's name can be made
 * to display as another's.
 */
function stripDangerousCharacters(value: string, keepNewlines: boolean): string {
  // The control ranges are written as \uXXXX escapes, so the source itself holds
  // no invisible bytes and the ESLint no-control-regex rule has nothing to flag.
  const withoutControls = value.replace(
    keepNewlines
      ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g
      : /[\u0000-\u001F\u007F-\u009F]/g,
    ''
  );
  return withoutControls.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu, '');
}

/** Every distinct placeholder a template uses, in first-appearance order. */
export function templateVariables(content: TemplateContent): readonly string[] {
  const found = new Set<string>();
  for (const source of [content.subject ?? '', content.body]) {
    PLACEHOLDER.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PLACEHOLDER.exec(source)) !== null) {
      if (match[1]) found.add(match[1]);
    }
  }
  return [...found];
}

/**
 * Renders `content` with `variables`.
 *
 * Strict in both directions. A placeholder with no value is an error rather than
 * an empty string, because "Dear ," is a message that should never have been
 * sent. A supplied value the template does not use is *also* an error: it means
 * the caller and the template disagree about the contract, and silently dropping
 * it is how a phone number ends up passed to a template that never shows it and
 * nobody notices for a year.
 */
export function renderTemplate(
  content: TemplateContent,
  variables: Readonly<Record<string, string>>,
  options: RenderOptions
): RenderedMessage {
  if (content.body.trim() === '') {
    throw new TemplateRenderError('Template body is blank', 'empty_body');
  }

  // `Object.prototype.hasOwnProperty.call(...)`, never `variables[name]`.
  //
  // `variables` arrives as a plain object, so a placeholder named after an
  // `Object.prototype` member — `constructor`, `toString`, `valueOf`,
  // `hasOwnProperty` — resolves *up the prototype chain* to a function instead of
  // being `undefined`. The missing-variable check would pass, and the inherited
  // function would then reach the string handling and throw a `TypeError`: an
  // administrator-authored template using one of those names would turn a clean
  // 422 into a 500. Found by `tests/foundation/p1-15-template-rendering.test.ts`.
  const owns = (name: string): boolean => Object.prototype.hasOwnProperty.call(variables, name);
  const valueOf = (name: string): unknown => (owns(name) ? variables[name] : undefined);

  const supplied = Object.keys(variables);
  const badNames = supplied.filter((name) => !VARIABLE_NAME_PATTERN.test(name));
  if (badNames.length > 0) {
    throw new TemplateRenderError(
      'Variable names must match the placeholder grammar',
      'invalid_variable_name',
      badNames.slice(0, 10)
    );
  }
  const badValues = supplied.filter((name) => typeof valueOf(name) !== 'string');
  if (badValues.length > 0) {
    throw new TemplateRenderError(
      'Every template variable value must be a string',
      'invalid_variable_value',
      badValues
    );
  }

  const used = templateVariables(content);
  const missing = used.filter((name) => !owns(name));
  if (missing.length > 0) {
    throw new TemplateRenderError(
      'Template placeholders have no supplied value',
      'missing_variable',
      missing
    );
  }
  const unknown = supplied.filter((name) => !used.includes(name));
  if (unknown.length > 0) {
    throw new TemplateRenderError(
      'Variables were supplied that this template does not use',
      'unknown_variable',
      unknown
    );
  }

  // Values are prepared ONCE, before substitution, so the substitution pass
  // itself performs no transformation a value could influence.
  const prepared = new Map<string, { subject: string; body: string }>();
  for (const name of used) {
    const raw = valueOf(name) as string;
    prepared.set(name, {
      subject: stripDangerousCharacters(raw, false).replace(/\s+/g, ' ').trim(),
      body: escapeHtml(stripDangerousCharacters(raw, true)),
    });
  }

  const substitute = (source: string, part: 'subject' | 'body'): string =>
    source.replace(PLACEHOLDER, (_whole, name: string) => prepared.get(name)?.[part] ?? '');

  const subject =
    content.subject === null
      ? null
      : substitute(content.subject, 'subject').replace(/\s+/g, ' ').trim();
  const body = substitute(content.body, 'body');

  const size = (subject?.length ?? 0) + body.length;
  if (size > options.maxRenderedChars) {
    throw new TemplateRenderError(
      `Rendered message is ${size} characters; the ceiling is ${options.maxRenderedChars}`,
      'rendered_too_large'
    );
  }

  return { subject, body, usedVariables: [...used].sort() };
}

/**
 * Canonical bytes hashed into `outbound_messages.body_sha256`.
 *
 * Subject and body are joined with a NUL separator rather than concatenated:
 * without a separator, `{subject: 'ab', body: 'c'}` and `{subject: 'a', body:
 * 'bc'}` would hash identically, and the digest would stop distinguishing two
 * genuinely different messages.
 */
export function canonicalRenderedForm(message: RenderedMessage): string {
  return `${message.subject ?? ''}\u0000${message.body}`;
}
