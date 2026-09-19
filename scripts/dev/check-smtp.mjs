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
 * ## It sends real mail
 *
 * One message, to one recipient, every time it is run. That is the whole point —
 * an accepted message that never arrives is a different answer from a rejected
 * one, and only delivery separates them. Do not run it casually, and do not run
 * it against an address that belongs to someone who did not ask for it.
 *
 * ## What it prints
 *
 * The server's own replies to the envelope commands, and nothing else. No
 * password, no authentication payload, no message body. The AUTH exchange is
 * carried out but never echoed, so the output of this script is safe to paste
 * into evidence.
 *
 * ## Configuration
 *
 * Five variables, the same ones `supabase/config.toml` expands:
 *
 *   SMTP_HOST  SMTP_PORT  SMTP_USER  SMTP_PASS  SMTP_SENDER_NAME
 *
 * They are read from the process environment. If a variable is absent, the
 * untracked `.env` at the repository root is consulted as a fallback, which is
 * there so that running this never requires typing a password onto a command
 * line where a shell history would keep it.
 *
 * ## Usage
 *
 *   node scripts/dev/check-smtp.mjs                 # sends to SMTP_USER
 *   node scripts/dev/check-smtp.mjs --to someone@example.com
 *
 * Exit code 0 means the relay accepted the message for delivery. Any other code
 * means it refused, and the refusal is printed verbatim.
 */

import { readFileSync } from 'node:fs';
import { connect } from 'node:tls';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV_FILE = join(REPOSITORY_ROOT, '.env');
const NAMES = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SENDER_NAME'];

/**
 * Fill in any of the five names the process environment does not already carry,
 * from the untracked root `.env`. Values already exported win, so an explicit
 * export is always able to override the file.
 */
function loadEnvironment() {
  const resolved = {};
  for (const name of NAMES) {
    const value = process.env[name];
    if (typeof value === 'string' && value.length > 0) {
      resolved[name] = value;
    }
  }

  let contents = '';
  try {
    contents = readFileSync(ENV_FILE, 'utf8');
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

/** Read `--to <address>` or `--to=<address>` off the command line. */
function readRecipientArgument(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--to') return argv[index + 1];
    if (argument.startsWith('--to=')) return argument.slice('--to='.length);
  }
  return undefined;
}

/**
 * A minimal SMTP client over an already-encrypted socket.
 *
 * Implicit TLS only: the socket is encrypted from the first byte, which is what
 * port 465 means. There is deliberately no STARTTLS path — a plaintext socket
 * that upgrades is a plaintext socket that can fail to upgrade, and this script
 * carries a password.
 */
class SmtpSession {
  constructor(socket) {
    this.socket = socket;
    this.buffer = '';
    this.pending = null;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      this.buffer += chunk;
      this.#drain();
    });
  }

  #drain() {
    if (this.pending === null) return;
    // A reply is complete when a line reads `NNN ` (space, not hyphen).
    const match = /^\d{3} [^\n]*\n/m.exec(this.buffer);
    if (match === null) return;
    const end = match.index + match[0].length;
    const reply = this.buffer.slice(0, end).replace(/\r\n$/, '');
    this.buffer = this.buffer.slice(end);
    const settle = this.pending;
    this.pending = null;
    settle({ code: Number(match[0].slice(0, 3)), text: reply.trim() });
  }

  /** Wait for the next complete reply. */
  read() {
    return new Promise((resolve) => {
      this.pending = resolve;
      this.#drain();
    });
  }

  /**
   * Send one command line and return the server's reply. The command itself is
   * never printed by this class; callers decide what is safe to show, and the
   * AUTH arguments are never shown.
   */
  async send(command) {
    this.socket.write(`${command}\r\n`);
    return this.read();
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

/** Reject a reply outside the 2xx range, printing the server's own words. */
function expect(reply, step) {
  if (reply.code >= 200 && reply.code < 400) return true;
  fail(`${step}: REJECTED by the server\n  ${reply.text}`);
  return false;
}

async function main() {
  const environment = loadEnvironment();
  const missing = NAMES.filter((name) => environment[name] === undefined);
  if (missing.length > 0) {
    fail(`Not configured. Missing: ${missing.join(', ')}`);
    return;
  }

  const port = Number(environment.SMTP_PORT);
  if (!Number.isInteger(port) || port <= 0) {
    fail('SMTP_PORT must be a port number.');
    return;
  }

  const from = environment.SMTP_USER;
  const to = readRecipientArgument(process.argv.slice(2)) ?? from;
  const host = environment.SMTP_HOST;

  process.stdout.write(`Relay   : ${host}:${port}\n`);
  process.stdout.write(`Sender  : ${from}\n`);
  process.stdout.write(`Recipient: ${to}\n\n`);

  const socket = await new Promise((resolve, reject) => {
    const attempt = connect({ host, port, servername: host }, () => resolve(attempt));
    attempt.setTimeout(30_000, () => attempt.destroy(new Error('timed out')));
    attempt.once('error', reject);
  });

  const session = new SmtpSession(socket);
  try {
    if (!expect(await session.read(), 'greeting')) return;
    const greeting = await session.send('EHLO localhost');
    if (!expect(greeting, 'EHLO')) return;

    // AUTH LOGIN: two base64 challenges. Neither the command nor the argument
    // is printed, here or anywhere below.
    if (!expect(await session.send('AUTH LOGIN'), 'AUTH')) return;
    if (!expect(await session.send(Buffer.from(from).toString('base64')), 'AUTH')) return;
    const authenticated = await session.send(Buffer.from(environment.SMTP_PASS).toString('base64'));
    if (!expect(authenticated, 'AUTH')) return;
    process.stdout.write(`AUTH     : accepted (${authenticated.code})\n`);

    const mailFrom = await session.send(`MAIL FROM:<${from}>`);
    if (!expect(mailFrom, 'MAIL FROM')) return;
    process.stdout.write(`MAIL FROM: ${mailFrom.text}\n`);

    const rcptTo = await session.send(`RCPT TO:<${to}>`);
    if (!expect(rcptTo, 'RCPT TO')) return;
    process.stdout.write(`RCPT TO  : ${rcptTo.text}\n`);

    if (!expect(await session.send('DATA'), 'DATA')) return;

    const sentAt = new Date().toISOString();
    const headers = [
      `From: ${environment.SMTP_SENDER_NAME} <${from}>`,
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
    const accepted = await session.send(`${headers.join('\r\n')}\r\n\r\n${body.join('\r\n')}\r\n.`);
    if (!expect(accepted, 'message')) return;
    process.stdout.write(`ACCEPTED : ${accepted.text}\n`);
    process.stdout.write(
      '\nThe relay accepted the message for delivery. Acceptance is not arrival:\n' +
        'confirm in the recipient mailbox, and watch the sending mailbox for a\n' +
        'delivery-failure notice.\n'
    );
  } finally {
    try {
      await session.send('QUIT');
    } catch {
      // The server may close first; nothing here depends on a clean QUIT.
    }
    socket.destroy();
  }
}

await main();
