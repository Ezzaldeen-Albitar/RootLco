#!/usr/bin/env node
/**
 * Check the outbound mail relay, without involving the stack.
 *
 * ## Why this exists
 *
 * `supabase/config.toml` can point the auth service at a real SMTP relay, but a
 * configuration that parses is not a relay that works. The failure modes are all
 * on the far side of the machine — a rejected password, a provider that refuses
 * the sender address, a recipient domain with nowhere to deliver — and none of
 * them are visible until something actually opens a socket and is told "no".
 *
 * This script is that socket. It speaks SMTP to the configured relay directly,
 * so it needs no container, no running stack and no database: it can be run
 * while the acceptance environment is mid-campaign without disturbing it.
 *
 * ## It is provider-neutral
 *
 * Nothing here knows or assumes which company operates the relay. No hostname,
 * no port default, no username convention and no provider name appears in this
 * file: every one of them is read from the environment. There is no
 * credential-shape logic of any kind either — the password is read as a string
 * and transmitted byte for byte, whatever it contains and however long it is.
 *
 * The provider selected for this deployment, and the settings its account
 * publishes, are recorded once — in `supabase/config.toml` beside
 * `[auth.email.smtp]`, and in section 17 of
 * `docs/platform/environment-configuration.md`.
 *
 * ## It configures authentication email, not application notifications
 *
 * Everything this script measures concerns the mail the IDENTITY SERVICE sends
 * about an account — confirmation, recovery, invitation. The product's own
 * notification capability is a different subsystem behind the `MessageProvider`
 * port, selected by `NOTIFICATION_PROVIDER`, whose default refuses to deliver
 * rather than pretending a provider exists. A green run here gives that
 * subsystem no outbound path, and is not evidence about it.
 *
 * ## The four delivery stages this script reports, one flag each
 *
 * Each stage is reported on its own line, because a pass at one is no evidence
 * at all for the next, and reporting them as one result is how "the relay
 * accepted it" becomes "the mail arrived":
 *
 *   Stage 1  SETTINGS            --settings      local only, no network. The six
 *                                                names are present, consistent,
 *                                                and read exactly as the CLI
 *                                                would read them; SMTP_PORT
 *                                                equals the literal port in
 *                                                `supabase/config.toml`.
 *   Stage 2  RELAY CONNECTION    --probe         TCP and TLS: implicit TLS on
 *                                                465, STARTTLS on 587. Lists the
 *                                                AUTH mechanisms offered. No
 *                                                credential is transmitted, so
 *                                                only SMTP_HOST and SMTP_PORT
 *                                                are required.
 *   Stage 3  AUTHENTICATION      --authenticate  stage 2, then AUTH, then QUIT
 *                                                without an envelope.
 *   Stage 4  MESSAGE ACCEPTANCE  --send --to <address>
 *                                                stages 2 and 3, then one real
 *                                                message to the one recipient
 *                                                named on the command line.
 *
 * Two further checks exist and this script CANNOT prove either of them. Every
 * mode prints both as NOT PROVEN BY THIS TOOL:
 *
 *   - inbox receipt: a person must confirm the message arrived in the recipient
 *     mailbox. A 250 at stage 4 is the relay taking custody, not arrival.
 *   - the application's own recovery and invitation emails through the auth
 *     service, which need `enabled = true` and a restarted stack.
 *
 * `--send` sends AS `SMTP_ADMIN_EMAIL`, not as `SMTP_USER`: those are two
 * identities, and the one the auth service presents is the former. The
 * recipient has no default and must be one the Owner has authorised.
 *
 * ## Transport, selected by the port
 *
 *   465  implicit TLS — encrypted from the first byte.
 *   587  STARTTLS — plaintext greeting, EHLO, STARTTLS, TLS upgrade, EHLO again.
 *
 * Any other port is refused rather than guessed. The session refuses to
 * authenticate over a connection that is not encrypted, and there is no flag
 * that relaxes it.
 *
 * ## What it prints
 *
 * No password, no authentication payload, no message body. An AUTH refusal is
 * printed as its SMTP status code, its enhanced status code and a fixed
 * classification — never the relay's own words, which can echo a challenge.
 * Every other relay reply that is printed first has any base64-looking token
 * (16 or more characters of `[A-Za-z0-9+/=]`) and any occurrence of the
 * configured user or password replaced by `[redacted]`. The AUTH mechanisms
 * a relay offers are printed only when they are names on a fixed allow-list of
 * SASL mechanisms; any other token is counted, never printed. The sender and
 * recipient mailboxes are printed masked — the first character of the local
 * part and the domain, as `n***@example.com`.
 *
 * ## It never waits forever
 *
 * Every read from the relay ends: a reply, the relay closing the connection, a
 * socket error, or no reply within the per-read limit (20 seconds, changed with
 * `--read-timeout <seconds>`). Each of the last three fails the stage that was
 * running, on its own stage line, with a non-zero exit.
 *
 * ## Configuration, read exactly as the pinned Supabase CLI reads it
 *
 * Six variables, the five `supabase/config.toml` expands plus the port:
 *
 *   SMTP_HOST  SMTP_PORT  SMTP_USER  SMTP_PASS  SMTP_ADMIN_EMAIL  SMTP_SENDER_NAME
 *
 * The pinned CLI (npm `supabase`, a Bun-compiled bundle) resolves `env(...)`
 * from the process environment first, and otherwise from the first of these
 * files that defines the name: `supabase/.env.<env>.local`,
 * `supabase/.env.local`, `supabase/.env.<env>`, `supabase/.env`, then the same
 * four names at the checkout root, where `<env>` is `SUPABASE_ENV` or
 * `development` (and `.env.local` is skipped when it is `test`). Each file is
 * parsed by the CLI's port of the godotenv rules, reproduced by `parseDotenv`
 * below so that every stage uses exactly the value the auth container would
 * receive:
 *
 *   - unquoted: trimmed, cut at the last ` #` or tab-`#`, `$NAME` and `${NAME}`
 *     expanded from names defined earlier in the same file;
 *   - double-quoted: `\n`, `\r` and backslash escapes processed, then `$NAME`
 *     expanded; `\$` is a literal dollar sign;
 *   - single-quoted: literal, nothing processed;
 *   - anything after a closing quote on the same line is discarded.
 *
 * `--settings` warns, naming the variable and never its value, when an unquoted
 * value holds a character those rules change.
 *
 * ## Usage
 *
 *   node scripts/dev/check-smtp.mjs --settings
 *   node scripts/dev/check-smtp.mjs --probe
 *   node scripts/dev/check-smtp.mjs --authenticate
 *   node scripts/dev/check-smtp.mjs --send --to <authorized-test-recipient>
 *
 * Any mode that opens a socket also accepts `--read-timeout <seconds>`.
 *
 * Exit code 0 means the chosen stage passed. Any other code means it did not.
 */

import { readFileSync } from 'node:fs';
import { connect as connectTls } from 'node:tls';
import { connect as connectTcp } from 'node:net';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The untracked root file the five `env(...)` references usually expand from. */
export const ENV_FILE = join(REPOSITORY_ROOT, '.env');

/** The tracked configuration whose `[auth.email.smtp]` port the container uses. */
export const CONFIG_FILE = join(REPOSITORY_ROOT, 'supabase', 'config.toml');

/** Every name this script or the auth service reads. */
export const NAMES = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_ADMIN_EMAIL',
  'SMTP_SENDER_NAME',
];

/**
 * Names the pinned CLI consults AHEAD of `[auth.email.smtp]`. When one is set,
 * the container receives it instead of the config value, and this script does
 * not model that path — so its presence makes stage 1 fail rather than pass.
 */
export const CLI_OVERRIDE_NAMES = [
  'SUPABASE_AUTH_EMAIL_SMTP_ENABLED',
  'SUPABASE_AUTH_EMAIL_SMTP_HOST',
  'SUPABASE_AUTH_EMAIL_SMTP_PORT',
  'SUPABASE_AUTH_EMAIL_SMTP_USER',
  'SUPABASE_AUTH_EMAIL_SMTP_PASS',
  'SUPABASE_AUTH_EMAIL_SMTP_ADMIN_EMAIL',
  'SUPABASE_AUTH_EMAIL_SMTP_SENDER_NAME',
];

/** Implicit TLS: the socket is encrypted before the greeting arrives. */
export const IMPLICIT_TLS_PORT = 465;

/** STARTTLS: a plaintext session that is upgraded before AUTH is permitted. */
export const STARTTLS_PORT = 587;

/** The four stages, in order, with the flag that reaches each. */
export const STAGES = [
  { number: 1, flag: '--settings', label: 'settings (local, no network)' },
  { number: 2, flag: '--probe', label: 'relay connection (TCP and TLS)' },
  { number: 3, flag: '--authenticate', label: 'authentication' },
  { number: 4, flag: '--send --to <address>', label: 'message acceptance by the relay' },
];

/** Printed by every mode: what no mode of this script can establish. */
export const NOT_PROVEN_LINES = [
  'NOT PROVEN BY THIS TOOL: inbox receipt. A person must confirm the message arrived in the recipient mailbox.',
  "NOT PROVEN BY THIS TOOL: the application's own recovery and invitation emails through the auth service. They need the relay activated in supabase/config.toml and the stack restarted.",
];

const STAGE_OF_MODE = { settings: 1, probe: 2, authenticate: 3, send: 4 };

const CONNECT_TIMEOUT_MS = 30_000;

/** How long one read waits for a reply before the stage fails. */
export const DEFAULT_READ_TIMEOUT_MS = 20_000;

/**
 * The SASL mechanism names this script will print when a relay offers them.
 * Anything else in the relay's AUTH line is counted and never echoed.
 */
export const KNOWN_SASL_MECHANISMS = [
  'PLAIN',
  'LOGIN',
  'CRAM-MD5',
  'DIGEST-MD5',
  'NTLM',
  'GSSAPI',
  'XOAUTH2',
  'OAUTHBEARER',
  'EXTERNAL',
  'ANONYMOUS',
  'SCRAM-SHA-1',
  'SCRAM-SHA-1-PLUS',
  'SCRAM-SHA-256',
  'SCRAM-SHA-256-PLUS',
];

/**
 * A refusal this script makes about itself, as opposed to one the server made.
 * The second kind is always a safety stop.
 */
export class LocalRefusal extends Error {}

/**
 * A reply outside 2xx/3xx. Carries only what is safe to print: the step, the
 * status code, the enhanced status code, a fixed classification, and — for a
 * step other than AUTH — the relay's text after redaction.
 */
export class SmtpRejection extends Error {
  constructor({ step, code, enhanced, classification, detail }) {
    const status = `SMTP ${code}${enhanced ? `, enhanced ${enhanced}` : ''}`;
    super(
      `${step}: REJECTED by the relay: ${classification} (${status})` +
        (detail ? `\n  relay said: ${detail}` : '')
    );
    this.step = step;
    this.code = code;
    this.enhanced = enhanced;
    this.classification = classification;
  }
}

/**
 * The connection to the relay ended without a reply: it was closed, it failed,
 * or nothing arrived in time. `reason` is a fixed phrase, never relay text.
 */
export class RelayConnectionError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

/* ------------------------------------------------------------------------- *
 * The CLI's .env rules
 * ------------------------------------------------------------------------- */

/** A file the CLI would refuse. Carries a line number, never file content. */
export class EnvFileParseError extends Error {
  constructor(reason, line) {
    super(`${reason} on line ${line}`);
    this.reason = reason;
    this.line = line;
  }
}

const EXPORT_PREFIX = /^\s*export\s+/;
const EXPANSION = /(\\)?(\$)(\()?\{?([A-Z0-9_]+)?\}?/g;

function skipToStatement(text) {
  let at = 0;
  while (at < text.length) {
    const character = text[at];
    if (character === ' ' || character === '\t' || character === '\n' || character === '\r') {
      at += 1;
      continue;
    }
    if (character === '#') {
      const newline = text.indexOf('\n', at);
      if (newline === -1) return '';
      at = newline + 1;
      continue;
    }
    break;
  }
  return text.slice(at);
}

function expandVariables(value, defined) {
  return value.replace(EXPANSION, (match, backslash, _dollar, paren, name) => {
    if (backslash === '\\' || paren === '(') return match.slice(1);
    if (name !== undefined && name !== '') return defined[name] ?? '';
    return match;
  });
}

function cutInlineComment(line) {
  for (let at = line.length - 1; at > 0; at -= 1) {
    if (line[at] === '#' && (line[at - 1] === ' ' || line[at - 1] === '\t')) {
      return line.slice(0, at);
    }
  }
  return line;
}

/**
 * Parse one `.env` file by the rules the pinned Supabase CLI applies — its
 * JavaScript port of godotenv, reproduced statement for statement, quirks
 * included. Returns every value and, per name, how it was written: the quote
 * character (or null), the raw text from after the `=` to the end of the line,
 * and whether text followed a closing quote (which the CLI discards).
 *
 * Throws `EnvFileParseError` where the CLI would refuse the file; the message
 * holds a line number and a fixed reason, never any of the file's text.
 *
 * @param {string} text
 * @returns {{
 *   values: Record<string, string>,
 *   details: Record<string, { quote: string | null, raw: string, line: number, discardedText: boolean }>,
 * }}
 */
export function parseDotenv(text) {
  const normalized = text.replaceAll('\r\n', '\n');
  const lineOf = (rest) => {
    const offset = normalized.length - rest.length;
    let line = 1;
    for (let at = 0; at < offset; at += 1) if (normalized[at] === '\n') line += 1;
    return line;
  };

  /** @type {Record<string, string>} */
  const values = {};
  /** @type {Record<string, { quote: string | null, raw: string, line: number, discardedText: boolean }>} */
  const details = {};
  let rest = normalized;
  for (;;) {
    rest = skipToStatement(rest);
    if (rest.length === 0) break;
    rest = rest.replace(EXPORT_PREFIX, '');

    let separator = -1;
    for (let at = 0; at < rest.length; at += 1) {
      const character = rest[at];
      if (character === '=' || character === ':') {
        separator = at;
        break;
      }
      if (character === '\n') break;
      if (character === ' ' || character === '\t') continue;
      if (!/[A-Za-z0-9_.]/.test(character)) {
        throw new EnvFileParseError('unexpected character in a variable name', lineOf(rest));
      }
    }
    const name = separator > 0 ? rest.slice(0, separator).trim() : '';
    if (name.length === 0) {
      throw new EnvFileParseError('unexpected character in a variable name', lineOf(rest));
    }

    const afterSeparator = rest.slice(separator + 1);
    const rawEnd = afterSeparator.indexOf('\n');
    const raw = rawEnd === -1 ? afterSeparator : afterSeparator.slice(0, rawEnd);
    const line = lineOf(rest);

    const valueText = afterSeparator.replace(/^[ \t]+/, '');
    const quote = valueText[0];
    if (quote === '"' || quote === "'") {
      let close = -1;
      for (let at = 1; at < valueText.length; at += 1) {
        if (valueText[at] === quote && valueText[at - 1] !== '\\') {
          close = at;
          break;
        }
      }
      if (close === -1) throw new EnvFileParseError('unterminated quoted value', line);
      const inner = valueText.slice(1, close);
      const after = valueText.slice(close + 1);
      const newline = after.indexOf('\n');
      const trailing = newline === -1 ? after : after.slice(0, newline);
      const trailingText = trailing.trim();
      const discardedText = trailingText.length > 0 && !trailingText.startsWith('#');
      let value = inner;
      if (quote === '"') {
        const unescaped = inner
          .replaceAll('\\n', '\n')
          .replaceAll('\\r', '\r')
          .replace(/\\([^$])/g, '$1');
        value = expandVariables(unescaped, values);
      }
      values[name] = value;
      details[name] = { quote, raw, line, discardedText };
      rest = newline === -1 ? '' : after.slice(newline);
      continue;
    }

    const newline = valueText.indexOf('\n');
    const unquotedLine = newline === -1 ? valueText : valueText.slice(0, newline);
    values[name] = expandVariables(cutInlineComment(unquotedLine).trim(), values);
    details[name] = { quote: null, raw, line, discardedText: false };
    rest = newline === -1 ? '' : valueText.slice(newline);
  }
  return { values, details };
}

/**
 * What an unquoted value holds that the CLI's rules would change, as fixed
 * phrases. Never the value, and never a fragment of it.
 */
export function unquotedValueHazards(raw) {
  const hazards = [];
  if (raw.includes('#')) hazards.push('a "#" (text after " #" is cut as a comment)');
  if (raw.includes('$')) hazards.push('a "$" (expanded as a variable reference)');
  if (raw.includes("'") || raw.includes('"')) hazards.push('a quote character');
  if (raw.length > 0 && (/^\s/.test(raw) || /\s$/.test(raw))) {
    hazards.push('leading or trailing whitespace (trimmed)');
  }
  return hazards;
}

/** The file names the CLI reads, in precedence order, for one directory. */
export function envFileNames(supabaseEnv) {
  const environment = supabaseEnv && supabaseEnv.length > 0 ? supabaseEnv : 'development';
  const names = [`.env.${environment}.local`];
  if (environment !== 'test') names.push('.env.local');
  names.push(`.env.${environment}`, '.env');
  return names;
}

/** Every file the CLI consults, in precedence order: `supabase/` first, then the root. */
export function defaultEnvFiles({ root = REPOSITORY_ROOT, supabaseEnv } = {}) {
  const names = envFileNames(supabaseEnv);
  return [join(root, 'supabase'), root].flatMap((directory) =>
    names.map((name) => join(directory, name))
  );
}

/**
 * Resolve the six names exactly as the pinned CLI resolves `env(...)`.
 *
 * The process environment wins outright — including an EMPTY exported value,
 * which the CLI then treats as unset, leaving the literal `env(NAME)` text in
 * the config. Otherwise the first file in `envFiles` that defines the name
 * supplies it. A file the CLI could not parse is reported, and the CLI would
 * refuse to start with it present.
 *
 * @returns {{
 *   values: Record<string, string>,
 *   sources: Record<string, string>,
 *   warnings: string[],
 *   parseErrors: string[],
 *   overrides: string[],
 * }}
 */
export function loadEnvironment({
  env = process.env,
  root = REPOSITORY_ROOT,
  envFiles = defaultEnvFiles({ root, supabaseEnv: env.SUPABASE_ENV }),
} = {}) {
  const fromFiles = {};
  const sourceOf = {};
  const detailOf = {};
  const parseErrors = [];

  for (const file of envFiles) {
    let contents;
    try {
      contents = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const fromRoot = relative(REPOSITORY_ROOT, file);
    const shown = fromRoot.length > 0 && !fromRoot.startsWith('..') ? fromRoot : file;
    let parsed;
    try {
      parsed = parseDotenv(contents);
    } catch (error) {
      const reason = error instanceof EnvFileParseError ? error.message : 'unreadable';
      parseErrors.push(`${shown}: ${reason}`);
      continue;
    }
    for (const [name, value] of Object.entries(parsed.values)) {
      if (env[name] !== undefined || fromFiles[name] !== undefined) continue;
      fromFiles[name] = value;
      sourceOf[name] = shown;
      detailOf[name] = parsed.details[name];
    }
  }

  const values = {};
  const sources = {};
  const warnings = [];
  for (const name of NAMES) {
    const exported = env[name];
    const resolved = typeof exported === 'string' ? exported : fromFiles[name];
    if (typeof exported === 'string') sources[name] = 'process environment';
    else if (fromFiles[name] !== undefined) sources[name] = sourceOf[name];
    // An empty value leaves `env(NAME)` unexpanded in the CLI: the same as unset.
    if (typeof resolved === 'string' && resolved.length > 0) values[name] = resolved;

    const detail = typeof exported === 'string' ? undefined : detailOf[name];
    if (detail === undefined) continue;
    if (detail.quote === null) {
      const hazards = unquotedValueHazards(detail.raw);
      if (hazards.length > 0) {
        warnings.push(
          `${name} (${sources[name]}, line ${detail.line}) is unquoted and contains ` +
            `${hazards.join(', ')}. The CLI changes such a value; write it in single quotes.`
        );
      }
    } else if (detail.discardedText) {
      warnings.push(
        `${name} (${sources[name]}, line ${detail.line}) has text after its closing quote. ` +
          'The CLI discards it, so the value is shorter than the line suggests.'
      );
    }
    if (typeof resolved === 'string' && resolved.startsWith('encrypted:')) {
      warnings.push(`${name} begins with "encrypted:", which the CLI tries to decrypt.`);
    }
  }

  const overrides = CLI_OVERRIDE_NAMES.filter((name) => {
    const value = env[name] ?? fromFiles[name];
    return typeof value === 'string' && value.length > 0;
  });

  return { values, sources, warnings, parseErrors, overrides };
}

/**
 * The literal `port` in the `[auth.email.smtp]` table of `supabase/config.toml`,
 * or null when the table or the literal is absent. This is the port the auth
 * container is given; `SMTP_PORT` is read by this script only.
 */
export function readConfigSmtpPort(configText) {
  let inTable = false;
  for (const line of configText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      inTable = trimmed === '[auth.email.smtp]';
      continue;
    }
    if (!inTable) continue;
    const match = /^port\s*=\s*(\d+)\s*(#.*)?$/.exec(trimmed);
    if (match !== null) return Number(match[1]);
  }
  return null;
}

/* ------------------------------------------------------------------------- *
 * What may be printed
 * ------------------------------------------------------------------------- */

const BASE64_LOOKING = /[A-Za-z0-9+/=]{16,}/g;

/**
 * Relay text made safe to print: any base64-looking token and any occurrence of
 * a configured secret (as written, or base64-encoded) becomes `[redacted]`.
 */
export function redactRelayText(text, secrets = []) {
  let safe = String(text);
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    for (const form of [secret, Buffer.from(secret, 'utf8').toString('base64')]) {
      safe = safe.split(form).join('[redacted]');
    }
  }
  return safe.replace(BASE64_LOOKING, '[redacted]');
}

/**
 * The line to print for the mechanisms a relay offers: only names on the
 * allow-list, in the relay's order, plus a count of every other token. The
 * line is redacted like any other relay text.
 */
export function describeAuthMechanisms(mechanisms, secrets = []) {
  const known = [];
  let unrecognised = 0;
  for (const mechanism of mechanisms) {
    const upper = String(mechanism).toUpperCase();
    if (KNOWN_SASL_MECHANISMS.includes(upper)) {
      if (!known.includes(upper)) known.push(upper);
    } else {
      unrecognised += 1;
    }
  }
  const parts = [];
  if (known.length > 0) parts.push(known.join(' '));
  else if (unrecognised === 0) parts.push('(none advertised)');
  else parts.push('(no recognised mechanism)');
  if (unrecognised > 0) {
    parts.push(`(${unrecognised} unrecognised token${unrecognised === 1 ? '' : 's'} not shown)`);
  }
  return redactRelayText(parts.join(' '), secrets);
}

/**
 * A mailbox address fit to print: the first character of the local part, then
 * `***`, then the domain. A value with no usable `@` keeps only its first
 * character.
 */
export function maskMailbox(address) {
  if (typeof address !== 'string' || address.length === 0) return '(not set)';
  const at = address.lastIndexOf('@');
  if (at <= 0 || at === address.length - 1) return `${address[0]}***`;
  return `${address[0]}***${address.slice(at)}`;
}

/** The RFC 3463 enhanced status code at the head of a reply, if present. */
export function enhancedStatusOf(replyText) {
  const match = /^\d{3}[ -](\d\.\d{1,3}\.\d{1,3})\b/.exec(String(replyText).trim());
  return match === null ? null : match[1];
}

const AUTH_CLASSIFICATION = {
  535: 'credentials rejected',
  534: 'the relay requires a different sign-in mechanism',
  538: 'the relay requires encryption for this mechanism',
  530: 'authentication required',
  504: 'authentication mechanism not supported',
  454: 'temporary authentication failure',
};

const ENVELOPE_CLASSIFICATION = {
  550: 'mailbox or sender refused',
  551: 'recipient not local to the relay',
  552: 'storage allocation exceeded',
  553: 'address not allowed',
  554: 'transaction failed',
  421: 'relay closing the connection',
  450: 'mailbox temporarily unavailable',
  451: 'relay-side processing error',
  452: 'relay temporarily out of resources',
};

/** A fixed phrase for a refusal. Never derived from the relay's own words. */
export function classifyReply(step, code) {
  const table = step === 'AUTH' ? AUTH_CLASSIFICATION : ENVELOPE_CLASSIFICATION;
  if (table[code] !== undefined) return table[code];
  if (code >= 400 && code < 500) return 'temporary failure reported by the relay';
  return 'permanent failure reported by the relay';
}

/* ------------------------------------------------------------------------- *
 * SMTP
 * ------------------------------------------------------------------------- */

/**
 * Which transport the port means. Only the two standard submission ports are
 * recognised: guessing wrong on the plaintext side is how a password leaves the
 * machine in the clear.
 */
export function tlsModeForPort(port) {
  if (port === IMPLICIT_TLS_PORT) return 'implicit';
  if (port === STARTTLS_PORT) return 'starttls';
  return null;
}

/**
 * The real sockets. Every function that speaks SMTP takes this object rather
 * than importing `node:tls` itself, so the protocol sequence can be exercised
 * by a suite against a local server without weakening anything here: there is
 * no flag, no environment variable and no code path in this file that disables
 * certificate verification or permits AUTH on a plaintext socket.
 */
export const nodeTransport = {
  connectSecure: ({ host, port }) =>
    new Promise((resolve, reject) => {
      const socket = connectTls({ host, port, servername: host }, () => resolve(socket));
      socket.setTimeout(CONNECT_TIMEOUT_MS, () => socket.destroy(new Error('timed out')));
      socket.once('error', reject);
    }),
  connectPlain: ({ host, port }) =>
    new Promise((resolve, reject) => {
      const socket = connectTcp({ host, port }, () => resolve(socket));
      socket.setTimeout(CONNECT_TIMEOUT_MS, () => socket.destroy(new Error('timed out')));
      socket.once('error', reject);
    }),
  upgrade: ({ socket, host }) =>
    new Promise((resolve, reject) => {
      const secure = connectTls({ socket, servername: host }, () => resolve(secure));
      secure.setTimeout(CONNECT_TIMEOUT_MS, () => secure.destroy(new Error('timed out')));
      secure.once('error', reject);
    }),
};

/**
 * A minimal SMTP client over whichever socket it is handed. The `encrypted`
 * flag — not the port, not the configuration — is what `authenticate`
 * consults.
 *
 * Every `read()` settles: with a reply, or by rejecting with
 * `RelayConnectionError` when the socket closes, ends or fails, or when no
 * reply arrives within `readTimeoutMs`. Once the connection has gone, every
 * later read rejects at once rather than waiting for bytes that cannot come.
 */
export class SmtpSession {
  #socket = null;
  #listeners = null;
  #buffer = '';
  #pending = null;
  #encrypted = false;
  #readTimeoutMs = DEFAULT_READ_TIMEOUT_MS;
  #lost = null;

  /**
   * @param {import('node:net').Socket} socket
   * @param {{ encrypted?: boolean, readTimeoutMs?: number }} [options]
   */
  constructor(socket, { encrypted, readTimeoutMs = DEFAULT_READ_TIMEOUT_MS } = {}) {
    this.#encrypted = encrypted === true;
    this.#readTimeoutMs = readTimeoutMs;
    this.#attach(socket);
  }

  /** True only while the underlying socket is known to be encrypted. */
  get encrypted() {
    return this.#encrypted;
  }

  /** The socket currently in use, which is what a TLS upgrade wraps. */
  get socket() {
    return this.#socket;
  }

  #attach(socket) {
    this.#socket = socket;
    this.#lost = null;
    if (typeof socket.setEncoding === 'function') socket.setEncoding('utf8');
    const listeners = {
      data: (chunk) => {
        this.#buffer += String(chunk);
        this.#drain();
      },
      end: () => this.#lose('connection closed by the relay'),
      close: () => this.#lose('connection closed by the relay'),
      error: (error) => {
        const code = error !== null && typeof error === 'object' ? error.code : undefined;
        this.#lose(
          typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)
            ? `connection error (${code})`
            : 'connection error'
        );
      },
    };
    for (const [event, listener] of Object.entries(listeners)) socket.on(event, listener);
    this.#listeners = listeners;
  }

  #detach() {
    if (this.#socket === null || this.#listeners === null) return;
    for (const [event, listener] of Object.entries(this.#listeners)) {
      this.#socket.removeListener(event, listener);
    }
    // A failure on the discarded transport must still have a listener, or
    // Node treats it as unhandled.
    this.#socket.on('error', () => {});
    this.#listeners = null;
  }

  /**
   * Continue the session on a different socket — the STARTTLS upgrade, and
   * nothing else. The old listeners are removed first so that two objects never
   * read the same stream, and the buffer is cleared because anything a server
   * sent between `220` and the handshake belongs to the discarded transport.
   */
  adopt(socket, { encrypted }) {
    this.#detach();
    this.#buffer = '';
    this.#pending = null;
    this.#encrypted = encrypted === true;
    this.#attach(socket);
  }

  #lose(reason) {
    if (this.#lost === null) this.#lost = reason;
    this.#drain();
    if (this.#pending === null) return;
    const { reject } = this.#pending;
    this.#settle();
    reject(new RelayConnectionError(this.#lost));
  }

  #settle() {
    if (this.#pending !== null) clearTimeout(this.#pending.timer);
    this.#pending = null;
  }

  #drain() {
    if (this.#pending === null) return;
    // A reply is complete when a line reads `NNN ` (space, not hyphen).
    const match = /^\d{3} [^\n]*\n/m.exec(this.#buffer);
    if (match === null) return;
    const end = match.index + match[0].length;
    const reply = this.#buffer.slice(0, end).replace(/\r\n$/, '');
    this.#buffer = this.#buffer.slice(end);
    const { resolve } = this.#pending;
    this.#settle();
    resolve({ code: Number(match[0].slice(0, 3)), text: reply.trim() });
  }

  /** Wait for the next complete reply, or reject when none can arrive. */
  read() {
    return new Promise((resolve, reject) => {
      const seconds = this.#readTimeoutMs / 1000;
      const timer = setTimeout(() => {
        this.#settle();
        reject(new RelayConnectionError(`no reply from the relay within ${seconds} s`));
      }, this.#readTimeoutMs);
      this.#pending = { resolve, reject, timer };
      this.#drain();
      if (this.#pending !== null && this.#lost !== null) {
        this.#settle();
        reject(new RelayConnectionError(this.#lost));
      }
    });
  }

  /** Send one command line and return the reply. Nothing is printed here. */
  async send(command) {
    if (this.#lost !== null) throw new RelayConnectionError(this.#lost);
    this.#socket.write(`${command}\r\n`);
    return this.read();
  }

  /** Best-effort close. Nothing depends on the server answering. */
  async close() {
    try {
      await this.send('QUIT');
    } catch {
      // The server may close first, or not answer at all.
    }
    this.#socket.destroy();
  }
}

/**
 * Throw `SmtpRejection` on a reply outside 2xx/3xx. An AUTH refusal carries no
 * relay text at all; any other carries the text only after redaction.
 */
function requireOk(reply, step, secrets = []) {
  if (reply.code >= 200 && reply.code < 400) return reply;
  const isAuth = step === 'AUTH';
  throw new SmtpRejection({
    step,
    code: reply.code,
    enhanced: enhancedStatusOf(reply.text),
    classification: classifyReply(isAuth ? 'AUTH' : step, reply.code),
    detail: isAuth ? undefined : redactRelayText(reply.text, secrets),
  });
}

/** The mechanisms an EHLO reply advertises, in the order the server listed them. */
export function parseAuthMechanisms(ehloText) {
  const mechanisms = [];
  for (const line of ehloText.split(/\r?\n/)) {
    const match = /^\d{3}[- ]AUTH[ =](.*)$/i.exec(line.trim());
    if (match === null) continue;
    for (const mechanism of match[1].trim().split(/\s+/)) {
      if (mechanism.length > 0 && !mechanisms.includes(mechanism)) mechanisms.push(mechanism);
    }
  }
  return mechanisms;
}

/** True when an EHLO reply offers the STARTTLS extension. */
export function advertisesStartTls(ehloText) {
  return ehloText.split(/\r?\n/).some((line) => /^\d{3}[- ]STARTTLS\s*$/i.test(line.trim()));
}

/**
 * Stage 2. Connect, negotiate encryption for the port, and return a session
 * that is ready for AUTH. No credential is touched here.
 *
 * @param {{
 *   host: string,
 *   port: number,
 *   transport?: typeof nodeTransport,
 *   secrets?: string[],
 *   readTimeoutMs?: number,
 * }} target
 */
export async function openRelay({
  host,
  port,
  transport = nodeTransport,
  secrets = [],
  readTimeoutMs = DEFAULT_READ_TIMEOUT_MS,
}) {
  const mode = tlsModeForPort(port);
  if (mode === null) {
    throw new LocalRefusal(
      `SMTP_PORT is ${port}. This script speaks ${IMPLICIT_TLS_PORT} (implicit TLS) and ` +
        `${STARTTLS_PORT} (STARTTLS) and will not guess the transport of any other port.`
    );
  }

  let session;
  if (mode === 'implicit') {
    session = new SmtpSession(await transport.connectSecure({ host, port }), {
      encrypted: true,
      readTimeoutMs,
    });
  } else {
    session = new SmtpSession(await transport.connectPlain({ host, port }), {
      encrypted: false,
      readTimeoutMs,
    });
  }

  try {
    requireOk(await session.read(), 'greeting', secrets);
    let ehlo = requireOk(await session.send('EHLO localhost'), 'EHLO', secrets);

    if (mode === 'starttls') {
      if (!advertisesStartTls(ehlo.text)) {
        throw new LocalRefusal(
          `The relay does not advertise STARTTLS on port ${port}, so this session cannot be ` +
            'encrypted. Refusing to continue on a plaintext connection.'
        );
      }
      requireOk(await session.send('STARTTLS'), 'STARTTLS', secrets);
      const upgraded = await transport.upgrade({ socket: session.socket, host });
      session.adopt(upgraded, { encrypted: true });
      ehlo = requireOk(await session.send('EHLO localhost'), 'EHLO after STARTTLS', secrets);
    }

    return { session, mode, mechanisms: parseAuthMechanisms(ehlo.text) };
  } catch (error) {
    await session.close();
    throw error;
  }
}

/**
 * Stage 3. AUTH LOGIN over an encrypted session. The password is base64-encoded
 * exactly as it was resolved — not trimmed, normalised or pattern-matched — and
 * neither the command, its arguments, nor the relay's reply text is printed.
 */
export async function authenticate(session, { user, pass }) {
  if (!session.encrypted) {
    throw new LocalRefusal(
      'Refusing to authenticate over an unencrypted connection. The password would cross the ' +
        'network in the clear.'
    );
  }
  requireOk(await session.send('AUTH LOGIN'), 'AUTH');
  requireOk(await session.send(Buffer.from(user, 'utf8').toString('base64')), 'AUTH');
  return requireOk(await session.send(Buffer.from(pass, 'utf8').toString('base64')), 'AUTH');
}

/**
 * Stage 4. One message, one recipient, sent as the auth service's sender
 * identity (`admin_email`) rather than the login.
 */
export async function sendMessage(session, { from, to, senderName, write, secrets = [] }) {
  const mailFrom = requireOk(await session.send(`MAIL FROM:<${from}>`), 'MAIL FROM', secrets);
  write(`MAIL FROM: ${redactRelayText(mailFrom.text, secrets)}\n`);

  const rcptTo = requireOk(await session.send(`RCPT TO:<${to}>`), 'RCPT TO', secrets);
  write(`RCPT TO  : ${redactRelayText(rcptTo.text, secrets)}\n`);

  requireOk(await session.send('DATA'), 'DATA', secrets);

  const sentAt = new Date().toISOString();
  const headers = [
    `From: ${senderName} <${from}>`,
    `To: <${to}>`,
    'Subject: RootLco acceptance harness - outbound relay check',
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
  ];
  const body = [
    'This message was sent by scripts/dev/check-smtp.mjs to check that the',
    'local acceptance environment can hand mail to an outside relay.',
    '',
    `Sent at ${sentAt}.`,
    '',
    'Nothing is expected of the reader beyond confirming that it arrived.',
  ];
  const accepted = requireOk(
    await session.send(`${headers.join('\r\n')}\r\n\r\n${body.join('\r\n')}\r\n.`),
    'message',
    secrets
  );
  write(`ACCEPTED : ${redactRelayText(accepted.text, secrets)}\n`);
  return accepted;
}

/* ------------------------------------------------------------------------- *
 * The command line
 * ------------------------------------------------------------------------- */

/**
 * Read the single mode flag, the optional recipient and the optional per-read
 * limit off the command line. A recipient that begins with `--` is refused
 * rather than accepted, and so is a read limit that is not a positive number of
 * seconds.
 */
export function parseArguments(argv) {
  const modes = [];
  let recipient;
  let recipientRefused = false;
  let readTimeoutMs = DEFAULT_READ_TIMEOUT_MS;
  let readTimeoutRefused = false;
  const takeReadTimeout = (candidate) => {
    const seconds =
      typeof candidate === 'string' && /^\d+(\.\d+)?$/.test(candidate)
        ? Number(candidate)
        : Number.NaN;
    if (!Number.isFinite(seconds) || seconds <= 0) {
      readTimeoutRefused = true;
      return;
    }
    readTimeoutMs = Math.round(seconds * 1000);
  };
  const takeRecipient = (candidate) => {
    if (typeof candidate !== 'string' || candidate.length === 0 || candidate.startsWith('--')) {
      recipientRefused = true;
      return;
    }
    recipient = candidate;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--settings' || argument === '--probe') modes.push(argument.slice(2));
    else if (argument === '--authenticate') modes.push('authenticate');
    else if (argument === '--send') modes.push('send');
    else if (argument === '--to') {
      takeRecipient(argv[index + 1]);
      index += 1;
    } else if (argument.startsWith('--to=')) takeRecipient(argument.slice('--to='.length));
    else if (argument === '--read-timeout') {
      takeReadTimeout(argv[index + 1]);
      index += 1;
    } else if (argument.startsWith('--read-timeout=')) {
      takeReadTimeout(argument.slice('--read-timeout='.length));
    }
  }
  return { modes, recipient, recipientRefused, readTimeoutMs, readTimeoutRefused };
}

/**
 * The names a mode cannot run without. `--probe` sends no credential, so it
 * needs only the relay's address; `--authenticate` needs the login and the
 * sender identity as well; `--send` needs all six.
 */
export function requiredNamesFor(mode) {
  if (mode === 'probe') return ['SMTP_HOST', 'SMTP_PORT'];
  if (mode === 'send') return [...NAMES];
  if (mode === 'authenticate') return NAMES.filter((name) => name !== 'SMTP_SENDER_NAME');
  return [];
}

const USAGE = [
  'Choose exactly one mode. Each flag reaches one stage:',
  ...STAGES.map((stage) => `  ${stage.flag.padEnd(28)}stage ${stage.number}: ${stage.label}`),
  '',
  'Any mode that opens a socket also accepts --read-timeout <seconds> (default 20).',
  '',
  ...NOT_PROVEN_LINES,
  '',
];

/** One line per stage, in order, from a map of stage number to verdict. */
export function stageReport(verdicts) {
  const lines = ['Stage results:'];
  for (const stage of STAGES) {
    const verdict = verdicts[stage.number] ?? `NOT RUN by this mode (run ${stage.flag})`;
    lines.push(`  Stage ${stage.number}  ${stage.label.padEnd(33)}: ${verdict}`);
  }
  lines.push('', ...NOT_PROVEN_LINES, '');
  return lines.join('\n');
}

/**
 * Stage 1. Local only: names and booleans, never a value — not even a
 * non-secret one — so its output is safe wherever the script's output is.
 */
export function reportSettings(loaded, write, { configText } = {}) {
  const environment = loaded.values;
  const rows = NAMES.map((name) => ({
    name,
    present: typeof environment[name] === 'string' && environment[name].length > 0,
    source: loaded.sources[name] ?? 'nowhere',
  }));

  write('Stage 1: settings. Local only; no socket is opened and no value is printed.\n\n');
  for (const row of rows) {
    write(`  ${row.name.padEnd(17)} present: ${row.present}   (from ${row.source})\n`);
  }

  const user = environment.SMTP_USER;
  const userLooksLikeMailbox = typeof user === 'string' && user.includes('@');
  const adminPresent =
    typeof environment.SMTP_ADMIN_EMAIL === 'string' && environment.SMTP_ADMIN_EMAIL.length > 0;
  const port = Number(environment.SMTP_PORT);
  const portRecognised = tlsModeForPort(port) !== null;
  const configPort = typeof configText === 'string' ? readConfigSmtpPort(configText) : null;
  const portMatchesConfig = configPort !== null && port === configPort;

  write(`\n  SMTP_USER is a complete mailbox address: ${userLooksLikeMailbox}\n`);
  write(`  SMTP_ADMIN_EMAIL present                : ${adminPresent}\n`);
  write(`  SMTP_PORT is 465 or 587                 : ${portRecognised}\n`);
  write(
    `  SMTP_PORT equals the config.toml port   : ${portMatchesConfig}` +
      `   ([auth.email.smtp] port = ${configPort ?? 'not found'})\n`
  );
  write(`  Every .env file parses by the CLI rules : ${loaded.parseErrors.length === 0}\n`);
  write(`  No SUPABASE_AUTH_EMAIL_SMTP_* override  : ${loaded.overrides.length === 0}\n`);

  if (!portMatchesConfig) {
    write(
      '\n  PORT MISMATCH: the auth container is given the literal port in the\n' +
        '  [auth.email.smtp] table of supabase/config.toml, not SMTP_PORT. SMTP_PORT is read\n' +
        '  by this script only, so a stage 2-4 result on a different port says nothing\n' +
        '  about the port the container will use. Make the two equal.\n'
    );
  }
  for (const problem of loaded.parseErrors) {
    write(`\n  UNPARSEABLE: ${problem}. The CLI refuses to start while this file is present.\n`);
  }
  for (const name of loaded.overrides) {
    write(
      `\n  OVERRIDE: ${name} is set. The CLI uses it ahead of [auth.email.smtp],\n` +
        '  and this check does not model that path. Unset it.\n'
    );
  }
  for (const warning of loaded.warnings) write(`\n  WARNING: ${warning}\n`);

  const ready =
    rows.every((row) => row.present) &&
    userLooksLikeMailbox &&
    portRecognised &&
    portMatchesConfig &&
    loaded.parseErrors.length === 0 &&
    loaded.overrides.length === 0;
  write(`\n  Ready to activate: ${ready}\n\n`);
  write(stageReport({ 1: ready ? 'PASS' : 'FAIL' }));
  return ready;
}

/**
 * The whole program, as a function, so that a suite can drive every mode
 * against a local server and read exactly what was printed.
 *
 * @param {{
 *   argv?: string[],
 *   env?: Record<string, string | undefined>,
 *   envFile?: string,
 *   envFiles?: string[],
 *   envRoot?: string,
 *   configFile?: string,
 *   transport?: typeof nodeTransport,
 *   stdout?: (text: string) => unknown,
 *   stderr?: (text: string) => unknown,
 * }} [options]
 * @returns {Promise<number>} the process exit code the mode earned
 */
export async function run({
  argv,
  env = process.env,
  envFile,
  envFiles,
  envRoot = REPOSITORY_ROOT,
  configFile = CONFIG_FILE,
  transport = nodeTransport,
  stdout = (text) => process.stdout.write(text),
  stderr = (text) => process.stderr.write(text),
} = {}) {
  const out = (text) => stdout(text);
  const err = (text) => stderr(text);

  const { modes, recipient, recipientRefused, readTimeoutMs, readTimeoutRefused } = parseArguments(
    argv ?? []
  );
  if (recipientRefused) {
    err('--to needs an address. A value that begins with "--" is a flag, not a recipient.\n');
    return 2;
  }
  if (readTimeoutRefused) {
    err('--read-timeout needs a positive number of seconds.\n');
    return 2;
  }
  if (modes.length !== 1) {
    err(
      modes.length === 0 ? 'No mode chosen.\n' : `More than one mode chosen: ${modes.join(', ')}\n`
    );
    err(USAGE.join('\n'));
    return 2;
  }
  const [mode] = modes;

  const files =
    envFiles ??
    (envFile !== undefined
      ? [envFile]
      : defaultEnvFiles({ root: envRoot, supabaseEnv: env.SUPABASE_ENV }));
  const loaded = loadEnvironment({ env, envFiles: files });
  const environment = loaded.values;

  if (mode === 'settings') {
    let configText;
    try {
      configText = readFileSync(configFile, 'utf8');
    } catch {
      configText = undefined;
    }
    return reportSettings(loaded, out, { configText }) ? 0 : 1;
  }

  if (mode === 'send' && (recipient === undefined || recipient.length === 0)) {
    err('--send needs --to <address>. There is no default recipient.\n');
    return 2;
  }

  const required = requiredNamesFor(mode);
  const missing = required.filter((name) => environment[name] === undefined);
  if (missing.length > 0) {
    err(`Not configured. Missing: ${missing.join(', ')}\n`);
    return 1;
  }

  const port = Number(environment.SMTP_PORT);
  if (!Number.isInteger(port) || port <= 0) {
    err('SMTP_PORT must be a port number.\n');
    return 1;
  }

  const host = environment.SMTP_HOST;
  // SMTP_USER logs in; SMTP_ADMIN_EMAIL is the address the auth service will
  // present as the sender, so it is the address whose acceptance is measured.
  const loginUser = environment.SMTP_USER;
  const sender = environment.SMTP_ADMIN_EMAIL;
  // Relay text that echoes a mailbox has it redacted, like any credential.
  const secrets = [environment.SMTP_PASS, loginUser, sender, recipient];
  const target = STAGES[STAGE_OF_MODE[mode] - 1];

  out(`Relay    : ${host}:${port}\n`);
  out(`Mode     : ${target.flag.split(' ')[0]} (stage ${target.number} of 4: ${target.label})\n`);
  if (mode === 'send') out(`Sender   : ${maskMailbox(sender)}\n`);
  if (mode === 'send') out(`Recipient: ${maskMailbox(recipient)}\n`);
  out('\n');

  const verdicts = { 1: 'NOT RUN by this mode (run --settings)' };
  let current = 2;
  let session = null;
  try {
    const opened = await openRelay({ host, port, transport, secrets, readTimeoutMs });
    session = opened.session;
    const transportName = opened.mode === 'implicit' ? 'implicit TLS' : 'STARTTLS';
    out(`Transport: ${transportName}, encrypted: ${session.encrypted}\n`);
    out(`AUTH offered: ${describeAuthMechanisms(opened.mechanisms, secrets)}\n`);
    verdicts[2] = `PASS (${transportName} on ${port}, encrypted: ${session.encrypted})`;

    if (mode === 'probe') {
      out('No credential was transmitted.\n\n');
      out(stageReport(verdicts));
      return 0;
    }

    current = 3;
    const authenticated = await authenticate(session, {
      user: loginUser,
      pass: environment.SMTP_PASS,
    });
    const authEnhanced = enhancedStatusOf(authenticated.text);
    verdicts[3] =
      `PASS (the relay accepted the credential: SMTP ${authenticated.code}` +
      `${authEnhanced ? `, enhanced ${authEnhanced}` : ''})`;

    if (mode === 'authenticate') {
      out('Nothing was sent.\n\n');
      out(stageReport(verdicts));
      return 0;
    }

    current = 4;
    const accepted = await sendMessage(session, {
      from: sender,
      to: recipient,
      senderName: environment.SMTP_SENDER_NAME,
      write: out,
      secrets,
    });
    verdicts[4] = `PASS (the relay accepted one message for delivery: SMTP ${accepted.code})`;
    out('\n');
    out(stageReport(verdicts));
    return 0;
  } catch (error) {
    const stage = STAGES[current - 1];
    const message =
      error instanceof RelayConnectionError
        ? `Stage ${stage.number} ${stage.label}: FAILED - ${error.reason}`
        : error instanceof SmtpRejection || error instanceof LocalRefusal
          ? error.message
          : redactRelayText(error instanceof Error ? error.message : String(error), secrets);
    err(`${message}\n`);
    verdicts[current] =
      error instanceof SmtpRejection
        ? `FAIL (${error.classification}; SMTP ${error.code}${error.enhanced ? `, enhanced ${error.enhanced}` : ''})`
        : error instanceof LocalRefusal
          ? 'FAIL (refused by this script before the relay was asked)'
          : error instanceof RelayConnectionError
            ? `FAIL (${error.reason})`
            : 'FAIL (connection error)';
    for (let later = current + 1; later <= target.number; later += 1) {
      verdicts[later] = 'NOT REACHED';
    }
    out('\n');
    out(stageReport(verdicts));
    return 1;
  } finally {
    if (session !== null) await session.close();
  }
}

/** True when this file was started directly rather than imported by a suite. */
const startedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (startedDirectly) {
  process.exitCode = await run({
    argv: process.argv.slice(2),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}
