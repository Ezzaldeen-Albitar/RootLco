#!/usr/bin/env node
/**
 * Prove the outbound mail relay, without involving the stack.
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
 * Nothing here knows or assumes which company operates the relay. There is no
 * credential-shape logic of any kind: the password is read as a string and
 * transmitted byte for byte, whatever it contains and however long it is. A
 * provider that requires a specially generated password and a provider that
 * takes the mailbox's ordinary one are the same case to this script, and the
 * only authority on which one applies is the provider's own account screen.
 *
 * ## Four modes, only one of which sends mail
 *
 * The modes are graded by what they risk, and exactly one must be chosen:
 *
 *   --settings      Reads the environment and prints names and booleans. No
 *                   socket, no credential, no network. This is the check to run
 *                   before activating the relay in `supabase/config.toml`.
 *   --probe         Opens the connection, negotiates encryption, prints the AUTH
 *                   mechanisms the relay advertises, and quits. NO credential is
 *                   transmitted, so this is safe against a relay whose lockout
 *                   policy is unknown.
 *   --authenticate  Negotiates encryption and authenticates, then quits without
 *                   an envelope. SMTP permits this: AUTH is a session command
 *                   and QUIT after it is a complete, legal session. It proves
 *                   the password and nothing about delivery.
 *   --send --to <address>
 *                   The above, plus one real message to one real recipient. The
 *                   recipient has no default and must be named on the command
 *                   line, so mail is never sent to an address this script chose.
 *
 * ## Transport, selected by the port
 *
 *   465  implicit TLS — encrypted from the first byte.
 *   587  STARTTLS — plaintext greeting, EHLO, STARTTLS, TLS upgrade, EHLO again.
 *
 * Any other port is refused rather than guessed. In BOTH modes the session
 * refuses to authenticate over a connection that is not encrypted: on 587 a
 * relay that does not advertise STARTTLS, or that refuses the upgrade, ends the
 * run before AUTH is reached. There is no flag to relax that.
 *
 * ## What it prints
 *
 * The server's own replies to the session and envelope commands, and nothing
 * else. No password, no authentication payload, no message body. The AUTH
 * exchange is carried out but never echoed, so the output of this script is safe
 * to paste into evidence.
 *
 * ## Configuration
 *
 * Six variables, the five `supabase/config.toml` expands plus the port:
 *
 *   SMTP_HOST  SMTP_PORT  SMTP_USER  SMTP_PASS  SMTP_ADMIN_EMAIL  SMTP_SENDER_NAME
 *
 * They are read from the process environment. If a variable is absent, the
 * untracked `.env` at the repository root is consulted as a fallback, which is
 * there so that running this never requires typing a password onto a command
 * line where a shell history would keep it.
 *
 * ## Usage
 *
 *   node scripts/dev/check-smtp.mjs --settings
 *   node scripts/dev/check-smtp.mjs --probe
 *   node scripts/dev/check-smtp.mjs --authenticate
 *   node scripts/dev/check-smtp.mjs --send --to someone@example.com
 *
 * Exit code 0 means the chosen mode succeeded. Any other code means it did not,
 * and the reason — the server's own words, where there is a server — is printed.
 */

import { readFileSync } from 'node:fs';
import { connect as connectTls } from 'node:tls';
import { connect as connectTcp } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The untracked file the five `env(...)` references in the config expand from. */
export const ENV_FILE = join(REPOSITORY_ROOT, '.env');

/** Every name this script or the auth service reads. */
export const NAMES = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_ADMIN_EMAIL',
  'SMTP_SENDER_NAME',
];

/** Implicit TLS: the socket is encrypted before the greeting arrives. */
export const IMPLICIT_TLS_PORT = 465;

/** STARTTLS: a plaintext session that is upgraded before AUTH is permitted. */
export const STARTTLS_PORT = 587;

const CONNECT_TIMEOUT_MS = 30_000;

/**
 * A refusal this script makes about itself, as opposed to one the server made.
 *
 * Separated so that "the relay said no" and "this script would not go there"
 * never read alike in the output. The second kind is always a safety stop.
 */
export class LocalRefusal extends Error {}

/**
 * Fill in any of the six names the process environment does not already carry,
 * from the untracked root `.env`. Values already exported win, so an explicit
 * export is always able to override the file.
 *
 * Values are taken verbatim apart from one pair of surrounding quotes, which is
 * the `.env` convention rather than an opinion about content. Nothing is
 * trimmed of inner whitespace, case-folded, length-checked or validated for
 * shape: a password is whatever the provider issued.
 */
export function loadEnvironment({ env = process.env, envFile = ENV_FILE } = {}) {
  const resolved = {};
  for (const name of NAMES) {
    const value = env[name];
    if (typeof value === 'string' && value.length > 0) {
      resolved[name] = value;
    }
  }

  let contents = '';
  try {
    contents = readFileSync(envFile, 'utf8');
  } catch {
    return resolved;
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    if (!NAMES.includes(name) || resolved[name] !== undefined) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value.length > 0) resolved[name] = value;
  }

  return resolved;
}

/**
 * Which transport the port means.
 *
 * Only the two standard submission ports are recognised. A third port could be
 * either transport and this script will not guess, because guessing wrong on
 * the plaintext side is how a password leaves the machine in the clear.
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
      secure.once('error', reject);
    }),
};

/**
 * A minimal SMTP client over whichever socket it is handed.
 *
 * The session tracks whether the socket it is currently reading is encrypted,
 * and that flag — not the port, not the configuration — is what `authenticate`
 * consults. A session built on a plaintext socket stays plaintext until
 * `adopt` is called with the upgraded one.
 */
export class SmtpSession {
  #socket = null;
  #onData = null;
  #buffer = '';
  #pending = null;
  #encrypted = false;

  constructor(socket, { encrypted }) {
    this.#encrypted = encrypted === true;
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
    socket.setEncoding('utf8');
    this.#onData = (chunk) => {
      this.#buffer += chunk;
      this.#drain();
    };
    socket.on('data', this.#onData);
  }

  /**
   * Continue the session on a different socket — the STARTTLS upgrade, and
   * nothing else. The old listener is removed first so that two objects never
   * read the same stream, and the buffer is cleared because anything a server
   * sent between `220` and the handshake belongs to the discarded transport.
   */
  adopt(socket, { encrypted }) {
    if (this.#socket !== null && this.#onData !== null) {
      this.#socket.removeListener('data', this.#onData);
    }
    this.#buffer = '';
    this.#pending = null;
    this.#encrypted = encrypted === true;
    this.#attach(socket);
  }

  #drain() {
    if (this.#pending === null) return;
    // A reply is complete when a line reads `NNN ` (space, not hyphen).
    const match = /^\d{3} [^\n]*\n/m.exec(this.#buffer);
    if (match === null) return;
    const end = match.index + match[0].length;
    const reply = this.#buffer.slice(0, end).replace(/\r\n$/, '');
    this.#buffer = this.#buffer.slice(end);
    const settle = this.#pending;
    this.#pending = null;
    settle({ code: Number(match[0].slice(0, 3)), text: reply.trim() });
  }

  /** Wait for the next complete reply. */
  read() {
    return new Promise((resolve) => {
      this.#pending = resolve;
      this.#drain();
    });
  }

  /**
   * Send one command line and return the server's reply. The command itself is
   * never printed by this class; callers decide what is safe to show, and the
   * AUTH arguments are never shown.
   */
  async send(command) {
    this.#socket.write(`${command}\r\n`);
    return this.read();
  }

  /** Best-effort close. Nothing depends on the server answering. */
  async close() {
    try {
      await this.send('QUIT');
    } catch {
      // The server may close first.
    }
    this.#socket.destroy();
  }
}

/** Throw on a reply outside the 2xx/3xx range, carrying the server's own words. */
function requireOk(reply, step) {
  if (reply.code >= 200 && reply.code < 400) return reply;
  throw new Error(`${step}: REJECTED by the server\n  ${reply.text}`);
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
 * Connect, negotiate encryption for the port, and return a session that is
 * ready for AUTH. No credential is touched here, so this is the whole of what
 * `--probe` does.
 *
 * @param {{ host: string, port: number, transport?: typeof nodeTransport }} target
 */
export async function openRelay({ host, port, transport = nodeTransport }) {
  const mode = tlsModeForPort(port);
  if (mode === null) {
    throw new LocalRefusal(
      `SMTP_PORT is ${port}. This script speaks ${IMPLICIT_TLS_PORT} (implicit TLS) and ` +
        `${STARTTLS_PORT} (STARTTLS) and will not guess the transport of any other port.`
    );
  }

  let session;
  if (mode === 'implicit') {
    session = new SmtpSession(await transport.connectSecure({ host, port }), { encrypted: true });
  } else {
    session = new SmtpSession(await transport.connectPlain({ host, port }), { encrypted: false });
  }

  try {
    requireOk(await session.read(), 'greeting');
    let ehlo = requireOk(await session.send('EHLO localhost'), 'EHLO');

    if (mode === 'starttls') {
      if (!advertisesStartTls(ehlo.text)) {
        throw new LocalRefusal(
          `The relay does not advertise STARTTLS on port ${port}, so this session cannot be ` +
            'encrypted. Refusing to continue on a plaintext connection.'
        );
      }
      requireOk(await session.send('STARTTLS'), 'STARTTLS');
      const upgraded = await transport.upgrade({ socket: session.socket, host });
      session.adopt(upgraded, { encrypted: true });
      ehlo = requireOk(await session.send('EHLO localhost'), 'EHLO after STARTTLS');
    }

    return { session, mode, mechanisms: parseAuthMechanisms(ehlo.text) };
  } catch (error) {
    await session.close();
    throw error;
  }
}

/**
 * AUTH LOGIN over an encrypted session.
 *
 * The password is base64-encoded exactly as it was read — `Buffer.from(pass)`
 * of the original string and nothing else. It is not trimmed, normalised,
 * case-folded, length-checked or pattern-matched anywhere in this file, because
 * every one of those would be this script deciding what a provider's password
 * may be. Neither the command nor either argument is ever printed.
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

/** One message, one recipient. The caller has already named the recipient. */
export async function sendMessage(session, { from, to, senderName, write }) {
  const mailFrom = requireOk(await session.send(`MAIL FROM:<${from}>`), 'MAIL FROM');
  write(`MAIL FROM: ${mailFrom.text}\n`);

  const rcptTo = requireOk(await session.send(`RCPT TO:<${to}>`), 'RCPT TO');
  write(`RCPT TO  : ${rcptTo.text}\n`);

  requireOk(await session.send('DATA'), 'DATA');

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
    'This message was sent by scripts/dev/check-smtp.mjs to prove that the',
    'local acceptance environment can hand mail to an outside relay.',
    '',
    `Sent at ${sentAt}.`,
    '',
    'Nothing is expected of the reader. If this arrived, outbound mail works.',
  ];
  const accepted = requireOk(
    await session.send(`${headers.join('\r\n')}\r\n\r\n${body.join('\r\n')}\r\n.`),
    'message'
  );
  write(`ACCEPTED : ${accepted.text}\n`);
  return accepted;
}

/** Read the single mode flag and the optional recipient off the command line. */
export function parseArguments(argv) {
  const modes = [];
  let recipient;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--settings' || argument === '--probe') modes.push(argument.slice(2));
    else if (argument === '--authenticate') modes.push('authenticate');
    else if (argument === '--send') modes.push('send');
    else if (argument === '--to') recipient = argv[index + 1];
    else if (argument.startsWith('--to=')) recipient = argument.slice('--to='.length);
  }
  return { modes, recipient };
}

const USAGE = [
  'Choose exactly one mode:',
  '  --settings                    names and booleans only; no socket, no credential',
  '  --probe                       connect and list AUTH mechanisms; sends no credential',
  '  --authenticate                connect, authenticate, quit; sends no mail',
  '  --send --to <address>         the above, plus one real message to that address',
  '',
];

/**
 * The pre-activation check.
 *
 * The Supabase CLI does not catch an unset variable: the unexpanded `env(...)`
 * text is a non-empty string, so the file parses and the relay quietly becomes
 * a hostname that does not resolve. This mode is what catches it, and it prints
 * names and booleans only — never a value, not even a non-secret one, so its
 * output is safe wherever the script's output is.
 */
export function reportSettings(environment, write) {
  const rows = NAMES.map((name) => {
    const value = environment[name];
    return { name, present: typeof value === 'string' && value.length > 0 };
  });

  write('Pre-activation check. Names and booleans only; no value is printed.\n\n');
  for (const row of rows) {
    write(`  ${row.name.padEnd(17)} present: ${row.present}\n`);
  }

  const user = environment.SMTP_USER;
  const userLooksLikeMailbox = typeof user === 'string' && user.includes('@');
  const adminPresent =
    typeof environment.SMTP_ADMIN_EMAIL === 'string' && environment.SMTP_ADMIN_EMAIL.length > 0;
  const port = Number(environment.SMTP_PORT);
  const portRecognised = tlsModeForPort(port) !== null;

  write(`\n  SMTP_USER is a complete mailbox address: ${userLooksLikeMailbox}\n`);
  write(`  SMTP_ADMIN_EMAIL present                : ${adminPresent}\n`);
  write(`  SMTP_PORT is 465 or 587                 : ${portRecognised}\n`);

  const ready = rows.every((row) => row.present) && userLooksLikeMailbox && portRecognised;
  write(`\n  Ready to activate: ${ready}\n`);
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
 *   transport?: typeof nodeTransport,
 *   stdout?: (text: string) => unknown,
 *   stderr?: (text: string) => unknown,
 * }} [options]
 * @returns {Promise<number>} the process exit code the mode earned
 */
export async function run({
  argv,
  env = process.env,
  envFile = ENV_FILE,
  transport = nodeTransport,
  stdout = (text) => process.stdout.write(text),
  stderr = (text) => process.stderr.write(text),
} = {}) {
  const out = (text) => stdout(text);
  const err = (text) => stderr(text);

  const { modes, recipient } = parseArguments(argv ?? []);
  if (modes.length !== 1) {
    err(
      modes.length === 0 ? 'No mode chosen.\n' : `More than one mode chosen: ${modes.join(', ')}\n`
    );
    err(USAGE.join('\n'));
    return 2;
  }
  const [mode] = modes;

  const environment = loadEnvironment({ env, envFile });

  if (mode === 'settings') {
    return reportSettings(environment, out) ? 0 : 1;
  }

  if (mode === 'send' && (recipient === undefined || recipient.length === 0)) {
    err('--send needs --to <address>. There is no default recipient.\n');
    return 2;
  }

  const required = mode === 'send' ? NAMES : NAMES.filter((name) => name !== 'SMTP_SENDER_NAME');
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
  const from = environment.SMTP_USER;

  out(`Relay    : ${host}:${port}\n`);
  out(`Mode     : ${mode}\n`);
  if (mode === 'send') out(`Recipient: ${recipient}\n`);
  out('\n');

  let session = null;
  try {
    const opened = await openRelay({ host, port, transport });
    session = opened.session;
    out(
      `Transport: ${opened.mode === 'implicit' ? 'implicit TLS' : 'STARTTLS'}, encrypted: ${session.encrypted}\n`
    );
    out(
      `AUTH offered: ${opened.mechanisms.length > 0 ? opened.mechanisms.join(' ') : '(none advertised)'}\n`
    );

    if (mode === 'probe') {
      out('\nProbe only. No credential was transmitted.\n');
      return 0;
    }

    const authenticated = await authenticate(session, { user: from, pass: environment.SMTP_PASS });
    out(`AUTH     : accepted (${authenticated.code})\n`);

    if (mode === 'authenticate') {
      out('\nThe relay accepted the credential. Nothing was sent, so this says\n');
      out('nothing about whether a message would be delivered.\n');
      return 0;
    }

    await sendMessage(session, {
      from,
      to: recipient,
      senderName: environment.SMTP_SENDER_NAME,
      write: out,
    });
    out(
      '\nThe relay accepted the message for delivery. Acceptance is not arrival:\n' +
        'confirm in the recipient mailbox, and watch the sending mailbox for a\n' +
        'delivery-failure notice.\n'
    );
    return 0;
  } catch (error) {
    err(`${error instanceof Error ? error.message : String(error)}\n`);
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
