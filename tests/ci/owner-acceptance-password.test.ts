/**
 * The acceptance tooling's credential handling.
 *
 * `P1-26-F-051` recorded that this tooling shipped seven CodeQL findings because
 * nothing had ever reviewed it: it is imported by no application module, has no
 * unit tests pointed at it, and runs only when a human runs it. This file exists
 * so that the security-relevant parts are no longer in that category.
 *
 * Two subjects, one concern. `generatePassword` produces the Owner's credential
 * and `reconstructPassword` is what stands between a file anyone could overwrite
 * and an outbound sign-in request. `scripts/dev/check-smtp.mjs` carries a
 * mailbox password to an outside relay, and its whole safety argument is that
 * the password is never modified, never printed and never transmitted over an
 * unencrypted socket.
 *
 * The SMTP cases live here rather than in a file of their own because the
 * P1-27 census over `tests/ci` is sealed, and because this is the suite that
 * already owns "the acceptance tooling nothing else reviews, where a credential
 * is involved".
 */
import {
  createServer,
  connect as connectTcp,
  type AddressInfo,
  type Server,
  type Socket,
} from 'node:net';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PASSWORD_ALPHABET,
  PASSWORD_GROUPS,
  PASSWORD_GROUP_SIZE,
  PASSWORD_LENGTH,
  generatePassword,
  reconstructPassword,
} from '../../scripts/dev/owner-acceptance/context.mjs';
import {
  IMPLICIT_TLS_PORT,
  LocalRefusal,
  NOT_PROVEN_LINES,
  STAGES,
  STARTTLS_PORT,
  SmtpSession,
  advertisesStartTls,
  authenticate,
  openRelay,
  parseAuthMechanisms,
  parseDotenv,
  readConfigSmtpPort,
  redactRelayText,
  run,
  tlsModeForPort,
} from '../../scripts/dev/check-smtp.mjs';

const VALID = 'ABCDE-fghij-23456-KLMNP';

describe('the acceptance password alphabet', () => {
  it('omits every character a human misreads', () => {
    // The whole reason for a custom alphabet. If these come back, the Owner
    // retypes a password wrong and reports a broken login.
    for (const ambiguous of ['0', 'O', '1', 'l', 'I']) {
      expect(PASSWORD_ALPHABET, `${ambiguous} must not be in the alphabet`).not.toContain(
        ambiguous
      );
    }
    expect(new Set(PASSWORD_ALPHABET).size).toBe(PASSWORD_ALPHABET.length);
  });

  it('describes the shape the generator actually produces', () => {
    expect(PASSWORD_LENGTH).toBe(PASSWORD_GROUPS * PASSWORD_GROUP_SIZE + (PASSWORD_GROUPS - 1));
    expect(VALID).toHaveLength(PASSWORD_LENGTH);
  });
});

describe('generatePassword', () => {
  it('draws only from the alphabet, in the documented shape', () => {
    for (let i = 0; i < 200; i += 1) {
      const password = generatePassword();
      expect(password).toHaveLength(PASSWORD_LENGTH);
      for (const group of password.split('-')) {
        expect(group).toHaveLength(PASSWORD_GROUP_SIZE);
        for (const character of group) expect(PASSWORD_ALPHABET).toContain(character);
      }
    }
  });

  it('does not repeat itself', () => {
    // Not a distribution test — a wired-shut generator test. A constant would
    // pass every assertion above.
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(generatePassword());
    expect(seen.size).toBe(200);
  });

  it('covers the whole alphabet across enough draws', () => {
    // The rejection-sampling fix (`js/biased-cryptographic-random`) discards
    // bytes at or above the largest whole multiple of the alphabet size. A
    // discard loop that dropped the tail of the alphabet instead of redrawing
    // would still produce valid-looking passwords, and this is what would
    // notice.
    const seen = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      for (const character of generatePassword().replaceAll('-', '')) seen.add(character);
    }
    expect(seen.size).toBe(PASSWORD_ALPHABET.length);
  });
});

describe('reconstructPassword', () => {
  it('returns a well-formed password unchanged', () => {
    expect(reconstructPassword(VALID)).toBe(VALID);
  });

  it('round-trips whatever the generator produces', () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generatePassword();
      expect(reconstructPassword(password)).toBe(password);
    }
  });

  it('refuses a value that is not a string', () => {
    for (const value of [undefined, null, 42, {}, ['a']]) {
      expect(() => reconstructPassword(value)).toThrow(/not a string/);
    }
  });

  it('refuses a wrong length', () => {
    expect(() => reconstructPassword(VALID.slice(0, -1))).toThrow(/characters, expected/);
    expect(() => reconstructPassword(`${VALID}x`)).toThrow(/characters, expected/);
  });

  it('refuses separators in the wrong places', () => {
    expect(() => reconstructPassword('ABCDEfghij-23456-KLMNP-')).toThrow(/group separator/);
  });

  it('refuses every character outside the alphabet', () => {
    // The point of the allow-list. Each of these is a payload someone who could
    // write the handoff file might try to push into the sign-in request. The NUL
    // is written as an escape rather than as itself: a raw NUL in the source
    // makes git classify this file as binary and render every diff of it as a
    // byte count, which no reviewer can read.
    for (const smuggled of ['/', ':', '"', '\\', '\u0000', ' ', '$', '<', '\n', 'O']) {
      const tampered = smuggled + VALID.slice(1);
      expect(() => reconstructPassword(tampered), smuggled).toThrow(/outside the acceptance/);
    }
  });

  it('emits the alphabet constant, not the caller string', () => {
    // The assertion the CodeQL fix rests on: every returned character is a
    // character of PASSWORD_ALPHABET, so no data from the file reaches the
    // network even when the input happens to be well-formed.
    const rebuilt = reconstructPassword(VALID);
    for (const character of rebuilt.replaceAll('-', '')) {
      expect(PASSWORD_ALPHABET).toContain(character);
    }
  });
});

/* ------------------------------------------------------------------------- *
 * scripts/dev/check-smtp.mjs
 * ------------------------------------------------------------------------- */

/**
 * A relay that speaks enough SMTP to be negotiated with, and records every line
 * it is sent.
 *
 * It is plaintext throughout, deliberately. What these cases are about is the
 * COMMAND SEQUENCE and the encryption PRECONDITION — that STARTTLS is offered,
 * requested, accepted and followed by a second EHLO before AUTH is attempted,
 * and that AUTH never happens on a session the client believes is unencrypted.
 * The TLS handshake itself is Node's and is not under test here; a suite cannot
 * perform one without shipping a private key into the tree, which is forbidden.
 * The upgrade is therefore supplied by the caller through the transport seam
 * that `check-smtp.mjs` exports for exactly this purpose, and whether it was
 * called is asserted rather than assumed.
 */
interface FakeRelay {
  readonly port: number;
  readonly lines: string[];
  close(): Promise<void>;
}

async function startFakeRelay({
  offerStartTls,
  authReply = '235 2.7.0 Accepted',
}: {
  offerStartTls: boolean;
  authReply?: string;
}): Promise<FakeRelay> {
  const lines: string[] = [];
  const sockets = new Set<Socket>();

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
    socket.setEncoding('utf8');

    let buffer = '';
    let inData = false;
    let authStep = 0;
    let upgraded = false;

    const handle = (line: string) => {
      if (inData) {
        if (line === '.') {
          inData = false;
          lines.push('<message body>');
          socket.write('250 2.0.0 Ok: queued\r\n');
        }
        return;
      }
      lines.push(line);

      if (authStep === 1) {
        authStep = 2;
        socket.write('334 UGFzc3dvcmQ6\r\n');
        return;
      }
      if (authStep === 2) {
        authStep = 0;
        socket.write(`${authReply}\r\n`);
        return;
      }

      const upper = line.toUpperCase();
      if (upper.startsWith('EHLO')) {
        const reply = ['250-fake relay'];
        if (offerStartTls && !upgraded) reply.push('250-STARTTLS');
        reply.push('250 AUTH LOGIN PLAIN');
        socket.write(`${reply.join('\r\n')}\r\n`);
        return;
      }
      if (upper === 'STARTTLS') {
        upgraded = true;
        socket.write('220 2.0.0 Ready to start TLS\r\n');
        return;
      }
      if (upper.startsWith('AUTH LOGIN')) {
        authStep = 1;
        socket.write('334 VXNlcm5hbWU6\r\n');
        return;
      }
      if (upper.startsWith('MAIL FROM')) {
        socket.write('250 2.1.0 Ok\r\n');
        return;
      }
      if (upper.startsWith('RCPT TO')) {
        socket.write('250 2.1.5 Ok\r\n');
        return;
      }
      if (upper === 'DATA') {
        inData = true;
        socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        return;
      }
      if (upper === 'QUIT') {
        socket.write('221 2.0.0 Bye\r\n');
        socket.end();
        return;
      }
      socket.write('502 5.5.2 Command not recognised\r\n');
    };

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (let at = buffer.indexOf('\r\n'); at !== -1; at = buffer.indexOf('\r\n')) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        handle(line);
      }
    });

    socket.write('220 fake relay ESMTP\r\n');
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  return {
    port: (server.address() as AddressInfo).port,
    lines,
    async close() {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, 'close');
    },
  };
}

/** Plaintext sockets, with an upgrade that records that it was asked for. */
function transportFor(relay: FakeRelay, upgrade: { called: boolean }) {
  const open = () =>
    new Promise<Socket>((resolve, reject) => {
      const socket = connectTcp({ host: '127.0.0.1', port: relay.port }, () => resolve(socket));
      socket.once('error', reject);
    });
  return {
    connectPlain: open,
    // Implicit TLS at this layer means only "the socket is already encrypted
    // when the greeting arrives", which is what a session built on this one
    // is told. The cases that use it assert the sequence, not the cipher.
    connectSecure: open,
    upgrade: ({ socket }: { socket: Socket }) => {
      upgrade.called = true;
      return Promise.resolve(socket);
    },
  };
}

/**
 * Spaces at both ends, an inner space, hyphens and punctuation — every shape a
 * provider is free to issue and that a well-meaning "clean up the input" line
 * would quietly destroy. It is a test string and authenticates against nothing.
 */
const AWKWARD_MAILBOX_SECRET = ' a b-c #$%&*! Zz ';

/**
 * The login and the sender are DIFFERENT addresses here, on purpose. The auth
 * service presents `admin_email`, not the mailbox it logs in with, so a fixture
 * that made them equal could not tell the two apart and the send mode could
 * quietly measure the wrong identity.
 */
const RELAY_LOGIN = 'mailbox@example.com';
const RELAY_SENDER = 'notifications@example.com';

const RELAY_ENVIRONMENT = {
  SMTP_HOST: '127.0.0.1',
  SMTP_USER: RELAY_LOGIN,
  SMTP_PASS: AWKWARD_MAILBOX_SECRET,
  SMTP_ADMIN_EMAIL: RELAY_SENDER,
  SMTP_SENDER_NAME: 'RootLco',
};

/** A path that does not exist, so no case can reach a real untracked `.env`. */
const NO_ENV_FILE = join(__dirname, 'check-smtp-no-such-env-file');

function collector() {
  const chunks: string[] = [];
  return { write: (text: string) => chunks.push(text), text: () => chunks.join('') };
}

/**
 * Write one throwaway `.env` under the OS temporary directory and hand back its
 * path. Never the repository's own file: these cases must not be able to read a
 * real credential even if one is present on the machine.
 */
function withEnvFile(body: string): { path: string; remove: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'rootlco-check-smtp-'));
  const path = join(directory, '.env');
  writeFileSync(path, body, 'utf8');
  return { path, remove: () => rmSync(directory, { recursive: true, force: true }) };
}

/** The AUTH LOGIN password argument, decoded back off the wire. */
function passwordOnTheWire(lines: string[]): string {
  const authAt = lines.indexOf('AUTH LOGIN');
  expect(authAt).toBeGreaterThan(-1);
  return Buffer.from(lines[authAt + 2] ?? '', 'base64').toString('utf8');
}

describe('check-smtp transport selection', () => {
  it('maps only the two submission ports, and refuses to guess any other', () => {
    expect(tlsModeForPort(IMPLICIT_TLS_PORT)).toBe('implicit');
    expect(tlsModeForPort(STARTTLS_PORT)).toBe('starttls');
    for (const port of [25, 26, 465000, 2525, 587000]) {
      expect(tlsModeForPort(port), String(port)).toBeNull();
    }
  });

  it('reads STARTTLS and the AUTH mechanisms out of a real EHLO reply', () => {
    const ehlo = '250-fake relay\r\n250-STARTTLS\r\n250 AUTH LOGIN PLAIN';
    expect(advertisesStartTls(ehlo)).toBe(true);
    expect(parseAuthMechanisms(ehlo)).toEqual(['LOGIN', 'PLAIN']);
    expect(advertisesStartTls('250-fake relay\r\n250 AUTH LOGIN')).toBe(false);
  });
});

describe('check-smtp on port 587', () => {
  it('negotiates STARTTLS and only then authenticates', async () => {
    const relay = await startFakeRelay({ offerStartTls: true });
    const upgrade = { called: false };
    const out = collector();
    const err = collector();
    try {
      const code = await run({
        argv: ['--authenticate'],
        env: { ...RELAY_ENVIRONMENT, SMTP_PORT: String(STARTTLS_PORT) },
        envFile: NO_ENV_FILE,
        transport: transportFor(relay, upgrade),
        stdout: out.write,
        stderr: err.write,
      });
      expect(err.text()).toBe('');
      expect(code).toBe(0);
    } finally {
      await relay.close();
    }

    expect(upgrade.called).toBe(true);
    // EHLO, STARTTLS, EHLO again, and only after all three, AUTH.
    expect(relay.lines.slice(0, 4)).toEqual([
      'EHLO localhost',
      'STARTTLS',
      'EHLO localhost',
      'AUTH LOGIN',
    ]);
    expect(relay.lines).toContain('QUIT');
    // `--authenticate` ends the session without an envelope.
    expect(relay.lines.some((line) => line.toUpperCase().startsWith('MAIL FROM'))).toBe(false);
  });

  it('refuses the relay that will not offer STARTTLS, before any credential moves', async () => {
    const relay = await startFakeRelay({ offerStartTls: false });
    const upgrade = { called: false };
    const out = collector();
    const err = collector();
    try {
      const code = await run({
        argv: ['--authenticate'],
        env: { ...RELAY_ENVIRONMENT, SMTP_PORT: String(STARTTLS_PORT) },
        envFile: NO_ENV_FILE,
        transport: transportFor(relay, upgrade),
        stdout: out.write,
        stderr: err.write,
      });
      expect(code).toBe(1);
    } finally {
      await relay.close();
    }

    expect(upgrade.called).toBe(false);
    expect(err.text()).toMatch(/does not advertise STARTTLS/);
    expect(relay.lines.some((line) => line.toUpperCase().startsWith('AUTH'))).toBe(false);
  });
});

describe('check-smtp refuses to authenticate in clear', () => {
  it('rejects AUTH on a session that is not encrypted, and sends nothing', async () => {
    const relay = await startFakeRelay({ offerStartTls: true });
    try {
      const socket = await new Promise<Socket>((resolve, reject) => {
        const attempt = connectTcp({ host: '127.0.0.1', port: relay.port }, () => resolve(attempt));
        attempt.once('error', reject);
      });
      const session = new SmtpSession(socket, { encrypted: false });
      expect(session.encrypted).toBe(false);

      await expect(
        authenticate(session, { user: 'mailbox@example.com', pass: AWKWARD_MAILBOX_SECRET })
      ).rejects.toBeInstanceOf(LocalRefusal);

      socket.destroy();
    } finally {
      await relay.close();
    }

    // Not one byte of the exchange reached the wire.
    expect(relay.lines).toEqual([]);
  });
});

describe('check-smtp probe mode', () => {
  it('lists the advertised mechanisms and transmits no credential', async () => {
    const relay = await startFakeRelay({ offerStartTls: true });
    const upgrade = { called: false };
    const out = collector();
    const err = collector();
    try {
      const code = await run({
        argv: ['--probe'],
        env: { ...RELAY_ENVIRONMENT, SMTP_PORT: String(STARTTLS_PORT) },
        envFile: NO_ENV_FILE,
        transport: transportFor(relay, upgrade),
        stdout: out.write,
        stderr: err.write,
      });
      expect(err.text()).toBe('');
      expect(code).toBe(0);
    } finally {
      await relay.close();
    }

    expect(out.text()).toContain('LOGIN PLAIN');
    expect(out.text()).toContain('No credential was transmitted');
    expect(relay.lines.some((line) => line.toUpperCase().startsWith('AUTH'))).toBe(false);
    expect(relay.lines).toEqual(['EHLO localhost', 'STARTTLS', 'EHLO localhost', 'QUIT']);
  });
});

describe('check-smtp credential handling', () => {
  it('transmits the password byte for byte, spaces and symbols included', async () => {
    const relay = await startFakeRelay({ offerStartTls: true });
    const upgrade = { called: false };
    const out = collector();
    const err = collector();
    try {
      const code = await run({
        argv: ['--send', '--to', 'recipient@example.com'],
        env: { ...RELAY_ENVIRONMENT, SMTP_PORT: String(STARTTLS_PORT) },
        envFile: NO_ENV_FILE,
        transport: transportFor(relay, upgrade),
        stdout: out.write,
        stderr: err.write,
      });
      expect(err.text()).toBe('');
      expect(code).toBe(0);
    } finally {
      await relay.close();
    }

    const authAt = relay.lines.indexOf('AUTH LOGIN');
    expect(authAt).toBeGreaterThan(-1);
    const user = Buffer.from(relay.lines[authAt + 1] ?? '', 'base64').toString('utf8');
    expect(user).toBe(RELAY_LOGIN);
    // Byte-for-byte: leading and trailing spaces survive, so do the symbols.
    expect(passwordOnTheWire(relay.lines)).toBe(AWKWARD_MAILBOX_SECRET);
    expect(relay.lines).toContain('RCPT TO:<recipient@example.com>');
  });

  it('sends as the address the auth service presents, not as the login', async () => {
    // `admin_email` is the auth service's sender identity; `user` only logs in.
    // A relay that accepts the login and refuses that sender is a real failure
    // mode, and a send mode addressed as the login would never meet it.
    const relay = await startFakeRelay({ offerStartTls: true });
    const upgrade = { called: false };
    const out = collector();
    const err = collector();
    try {
      const code = await run({
        argv: ['--send', '--to', 'recipient@example.com'],
        env: { ...RELAY_ENVIRONMENT, SMTP_PORT: String(STARTTLS_PORT) },
        envFile: NO_ENV_FILE,
        transport: transportFor(relay, upgrade),
        stdout: out.write,
        stderr: err.write,
      });
      expect(err.text()).toBe('');
      expect(code).toBe(0);
    } finally {
      await relay.close();
    }

    expect(relay.lines).toContain(`MAIL FROM:<${RELAY_SENDER}>`);
    expect(relay.lines).not.toContain(`MAIL FROM:<${RELAY_LOGIN}>`);
  });

  it('refuses a recipient that is really a flag', async () => {
    // `--send --to --probe` is two intentions, one of which would otherwise be
    // swallowed: the run would address a message to an address named "--probe".
    const out = collector();
    const err = collector();
    const code = await run({
      argv: ['--send', '--to', '--probe'],
      env: { ...RELAY_ENVIRONMENT, SMTP_PORT: String(STARTTLS_PORT) },
      envFile: NO_ENV_FILE,
      stdout: out.write,
      stderr: err.write,
    });
    expect(code).toBe(2);
    expect(err.text()).toMatch(/begins with "--" is a flag/);
    expect(out.text()).toBe('');
  });

  it('prints neither the password nor its wire encoding, on any stream', async () => {
    const relay = await startFakeRelay({ offerStartTls: true });
    const upgrade = { called: false };
    const out = collector();
    const err = collector();
    try {
      await run({
        argv: ['--send', '--to', 'recipient@example.com'],
        env: { ...RELAY_ENVIRONMENT, SMTP_PORT: String(STARTTLS_PORT) },
        envFile: NO_ENV_FILE,
        transport: transportFor(relay, upgrade),
        stdout: out.write,
        stderr: err.write,
      });
    } finally {
      await relay.close();
    }

    const printed = out.text() + err.text();
    expect(printed).not.toContain(AWKWARD_MAILBOX_SECRET);
    expect(printed).not.toContain(Buffer.from(AWKWARD_MAILBOX_SECRET, 'utf8').toString('base64'));
    expect(printed).not.toContain('AUTH LOGIN');
    expect(printed).toMatch(/Stage 3 {2}authentication\s+: PASS/);
  });

  it('has no default recipient', async () => {
    const out = collector();
    const err = collector();
    const code = await run({
      argv: ['--send'],
      env: { ...RELAY_ENVIRONMENT, SMTP_PORT: String(STARTTLS_PORT) },
      envFile: NO_ENV_FILE,
      stdout: out.write,
      stderr: err.write,
    });
    expect(code).toBe(2);
    expect(err.text()).toMatch(/no default recipient/i);
    expect(out.text()).toBe('');
  });

  it('refuses a run with no mode, rather than choosing one', async () => {
    const out = collector();
    const err = collector();
    const code = await run({
      argv: [],
      env: { ...RELAY_ENVIRONMENT, SMTP_PORT: String(STARTTLS_PORT) },
      envFile: NO_ENV_FILE,
      stdout: out.write,
      stderr: err.write,
    });
    expect(code).toBe(2);
    expect(err.text()).toMatch(/No mode chosen/);
  });
});

/**
 * The `.env` path, which is the path the Owner is actually told to use. The
 * cases above supply the six names through the process environment, which is
 * the branch that cannot transform anything. A file is different: the pinned
 * Supabase CLI parses it by godotenv rules before the auth container ever sees
 * a value, and the script must hand the relay exactly that value — not the line
 * as typed — or every stage it runs measures a password the container will
 * never send.
 */
describe('check-smtp reads .env by the CLI rules', () => {
  const envFileBody = (passwordLine: string) =>
    [
      '# A comment line, which must be skipped rather than parsed.',
      '',
      'SMTP_HOST=127.0.0.1',
      `SMTP_PORT=${STARTTLS_PORT}`,
      `SMTP_USER=${RELAY_LOGIN}`,
      passwordLine,
      `SMTP_ADMIN_EMAIL=${RELAY_SENDER}`,
      'SMTP_SENDER_NAME=RootLco',
      '',
    ].join('\n');

  async function authenticateFromFile(body: string, env: Record<string, string> = {}) {
    const file = withEnvFile(body);
    const relay = await startFakeRelay({ offerStartTls: true });
    const upgrade = { called: false };
    const out = collector();
    const err = collector();
    try {
      const code = await run({
        argv: ['--authenticate'],
        env,
        envFile: file.path,
        transport: transportFor(relay, upgrade),
        stdout: out.write,
        stderr: err.write,
      });
      expect(err.text()).toBe('');
      expect(code).toBe(0);
      return { lines: [...relay.lines], printed: out.text() };
    } finally {
      await relay.close();
      file.remove();
    }
  }

  it('takes a single-quoted value literally, "#" and "$" included', async () => {
    const literal = ' p#ss $HOME ${SMTP_USER} \\n end ';
    const { lines } = await authenticateFromFile(envFileBody(`SMTP_PASS='${literal}'`));
    expect(passwordOnTheWire(lines)).toBe(literal);
  });

  it('trims an unquoted value and cuts it at an inline comment, as the CLI does', async () => {
    const { lines } = await authenticateFromFile(
      envFileBody('SMTP_PASS=   pa55 word   # the rest is a comment')
    );
    expect(passwordOnTheWire(lines)).toBe('pa55 word');
  });

  it('processes the escapes of a double-quoted value, as the CLI does', async () => {
    // On disk: SMTP_PASS="a\"b\\c\$D e"  ->  a"b\c$D e
    const { lines } = await authenticateFromFile(envFileBody('SMTP_PASS="a\\"b\\\\c\\$D e"'));
    expect(passwordOnTheWire(lines)).toBe('a"b\\c$D e');
  });

  it('keeps the spaces at both ends of a double-quoted value', async () => {
    const { lines } = await authenticateFromFile(
      envFileBody(`SMTP_PASS="${AWKWARD_MAILBOX_SECRET}"`)
    );
    expect(passwordOnTheWire(lines)).toBe(AWKWARD_MAILBOX_SECRET);
  });

  it('lets an exported value win over the file', async () => {
    const exported = '  exported-value  ';
    const { lines } = await authenticateFromFile(envFileBody(`SMTP_PASS='file-value'`), {
      SMTP_PASS: exported,
    });
    expect(passwordOnTheWire(lines)).toBe(exported);
  });

  it('parses each godotenv case the way the pinned CLI does', () => {
    const { values } = parseDotenv(
      [
        'A=1',
        "SINGLE='x #y $A ${A}'",
        'UNQUOTED=   a b   # comment',
        'EXPANDED=$A-${A}',
        'DOUBLE="q\\"r\\$A$A"',
        "TRAILING='kept'discarded",
        'export EXPORTED=yes',
        '',
      ].join('\r\n')
    );
    expect(values.SINGLE).toBe('x #y $A ${A}');
    expect(values.UNQUOTED).toBe('a b');
    expect(values.EXPANDED).toBe('1-1');
    expect(values.DOUBLE).toBe('q"r$A1');
    expect(values.TRAILING).toBe('kept');
    expect(values.EXPORTED).toBe('yes');
  });

  it('refuses a file the CLI would refuse, without echoing its text', () => {
    expect(() => parseDotenv("OK=1\nSMTP_PASS='never closed\n")).toThrow(
      /^unterminated quoted value on line 2$/
    );
    expect(() => parseDotenv('OK=1\nnot a statement\n')).toThrow(
      /^unexpected character in a variable name on line 2$/
    );
  });

  it('warns about an unquoted value the CLI would change, naming it but never printing it', async () => {
    const unquoted = ' ab#cd $EFG ';
    const file = withEnvFile(
      envFileBody(`SMTP_PASS=${unquoted}`).replace(
        `SMTP_PORT=${STARTTLS_PORT}`,
        `SMTP_PORT=${IMPLICIT_TLS_PORT}`
      )
    );
    const out = collector();
    const err = collector();
    try {
      await run({
        argv: ['--settings'],
        env: {},
        envFile: file.path,
        stdout: out.write,
        stderr: err.write,
      });
    } finally {
      file.remove();
    }
    const printed = out.text() + err.text();
    expect(printed).toMatch(/WARNING: SMTP_PASS .* is unquoted and contains/);
    expect(printed).toContain('write it in single quotes');
    expect(printed).not.toContain('ab#cd');
    expect(printed).not.toContain('$EFG');
  });
});

describe('check-smtp pre-activation settings mode', () => {
  it('reports names and booleans, opens no socket, and prints no value', async () => {
    const out = collector();
    const err = collector();
    const code = await run({
      argv: ['--settings'],
      env: { ...RELAY_ENVIRONMENT, SMTP_PORT: String(IMPLICIT_TLS_PORT) },
      envFile: NO_ENV_FILE,
      stdout: out.write,
      stderr: err.write,
    });
    expect(code).toBe(0);

    const printed = out.text();
    expect(printed).toContain('SMTP_PASS');
    expect(printed).toContain('Ready to activate: true');
    expect(printed).not.toContain(AWKWARD_MAILBOX_SECRET);
    expect(printed).not.toContain(RELAY_LOGIN);
    expect(printed).not.toContain(RELAY_SENDER);
    expect(err.text()).toBe('');
  });

  it('fails when a name the auth service needs is unset', async () => {
    const out = collector();
    const err = collector();
    const code = await run({
      argv: ['--settings'],
      // An empty value is the same absence as an unset name: this is the case
      // the Supabase CLI does not catch, because `env(...)` still expands to a
      // non-empty literal and the file goes on parsing.
      env: { ...RELAY_ENVIRONMENT, SMTP_ADMIN_EMAIL: '', SMTP_PORT: String(IMPLICIT_TLS_PORT) },
      envFile: NO_ENV_FILE,
      stdout: out.write,
      stderr: err.write,
    });
    expect(code).toBe(1);
    expect(out.text()).toMatch(/SMTP_ADMIN_EMAIL\s+present: false/);
    expect(out.text()).toContain('Ready to activate: false');
  });

  it('refuses a port it cannot map to a transport', async () => {
    const out = collector();
    const err = collector();
    const code = await run({
      argv: ['--settings'],
      env: { ...RELAY_ENVIRONMENT, SMTP_PORT: '25' },
      envFile: NO_ENV_FILE,
      stdout: out.write,
      stderr: err.write,
    });
    expect(code).toBe(1);
    expect(out.text()).toMatch(/SMTP_PORT is 465 or 587\s+: false/);
  });
});

describe('check-smtp on port 465', () => {
  it('treats the connection as encrypted from the greeting and never sends STARTTLS', async () => {
    const relay = await startFakeRelay({ offerStartTls: false });
    const upgrade = { called: false };
    try {
      const opened = await openRelay({
        host: '127.0.0.1',
        port: IMPLICIT_TLS_PORT,
        transport: transportFor(relay, upgrade),
      });
      expect(opened.mode).toBe('implicit');
      expect(opened.session.encrypted).toBe(true);
      expect(opened.mechanisms).toEqual(['LOGIN', 'PLAIN']);
      await opened.session.close();
    } finally {
      await relay.close();
    }

    expect(upgrade.called).toBe(false);
    expect(relay.lines).toEqual(['EHLO localhost', 'QUIT']);
  });
});

describe('check-smtp settings compare SMTP_PORT with supabase/config.toml', () => {
  it('reads the literal port of [auth.email.smtp] and nothing else', () => {
    const toml = [
      '[local_smtp]',
      'port = 54324',
      '[auth.email.smtp]',
      'enabled = false',
      'port = 465 # a trailing comment',
      '[auth.email.template.invite]',
      'port = 1',
    ].join('\n');
    expect(readConfigSmtpPort(toml)).toBe(465);
    expect(readConfigSmtpPort('[auth.email.smtp]\nenabled = false\n')).toBeNull();
    // The committed file is the one the container reads.
    expect(
      readConfigSmtpPort(
        readFileSync(join(__dirname, '..', '..', 'supabase', 'config.toml'), 'utf8')
      )
    ).toBe(IMPLICIT_TLS_PORT);
  });

  it('refuses an SMTP_PORT that differs from the config.toml port', async () => {
    const out = collector();
    const err = collector();
    const code = await run({
      argv: ['--settings'],
      // 587 is a port the transport rules recognise, and still NOT ready,
      // because the committed config gives the container 465.
      env: { ...RELAY_ENVIRONMENT, SMTP_PORT: String(STARTTLS_PORT) },
      envFile: NO_ENV_FILE,
      stdout: out.write,
      stderr: err.write,
    });
    expect(code).toBe(1);
    expect(out.text()).toMatch(/SMTP_PORT is 465 or 587\s+: true/);
    expect(out.text()).toMatch(/SMTP_PORT equals the config.toml port\s+: false/);
    expect(out.text()).toContain('PORT MISMATCH');
    expect(out.text()).toContain('not SMTP_PORT');
    expect(out.text()).toContain('Ready to activate: false');
    expect(out.text()).toMatch(/Stage 1 {2}settings \(local, no network\)\s+: FAIL/);
  });

  it('refuses a CLI override that would bypass [auth.email.smtp]', async () => {
    const out = collector();
    const code = await run({
      argv: ['--settings'],
      env: {
        ...RELAY_ENVIRONMENT,
        SMTP_PORT: String(IMPLICIT_TLS_PORT),
        SUPABASE_AUTH_EMAIL_SMTP_PORT: String(STARTTLS_PORT),
      },
      envFile: NO_ENV_FILE,
      stdout: out.write,
      stderr: collector().write,
    });
    expect(code).toBe(1);
    expect(out.text()).toContain('OVERRIDE: SUPABASE_AUTH_EMAIL_SMTP_PORT is set');
  });
});

describe('check-smtp reports the four delivery stages separately', () => {
  it('numbers and labels the stages 1 to 4, one flag each', () => {
    expect(STAGES.map((stage) => [stage.number, stage.flag, stage.label])).toEqual([
      [1, '--settings', 'settings (local, no network)'],
      [2, '--probe', 'relay connection (TCP and TLS)'],
      [3, '--authenticate', 'authentication'],
      [4, '--send --to <address>', 'message acceptance by the relay'],
    ]);
  });

  it('prints every stage line and both NOT PROVEN lines in every mode', async () => {
    expect(NOT_PROVEN_LINES).toHaveLength(2);
    expect(NOT_PROVEN_LINES[0]).toMatch(/^NOT PROVEN BY THIS TOOL: inbox receipt\./);
    expect(NOT_PROVEN_LINES[1]).toMatch(
      /^NOT PROVEN BY THIS TOOL: the application's own recovery and invitation emails through the auth service\./
    );

    const expectations: Record<string, Record<number, RegExp>> = {
      '--settings': { 1: /PASS/, 2: /NOT RUN/, 3: /NOT RUN/, 4: /NOT RUN/ },
      '--probe': { 1: /NOT RUN/, 2: /PASS/, 3: /NOT RUN/, 4: /NOT RUN/ },
      '--authenticate': { 1: /NOT RUN/, 2: /PASS/, 3: /PASS/, 4: /NOT RUN/ },
      '--send': { 1: /NOT RUN/, 2: /PASS/, 3: /PASS/, 4: /PASS/ },
    };
    for (const [flag, verdicts] of Object.entries(expectations)) {
      const relay = await startFakeRelay({ offerStartTls: false });
      const out = collector();
      const err = collector();
      try {
        const code = await run({
          argv: flag === '--send' ? ['--send', '--to', 'recipient@example.com'] : [flag],
          env: { ...RELAY_ENVIRONMENT, SMTP_PORT: String(IMPLICIT_TLS_PORT) },
          envFile: NO_ENV_FILE,
          transport: transportFor(relay, { called: false }),
          stdout: out.write,
          stderr: err.write,
        });
        expect(code, flag).toBe(0);
        expect(err.text(), flag).toBe('');
      } finally {
        await relay.close();
      }
      for (const stage of STAGES) {
        const line = out
          .text()
          .split('\n')
          .find((candidate) => candidate.startsWith(`  Stage ${stage.number}  ${stage.label}`));
        expect(line, `${flag} stage ${stage.number}`).toBeDefined();
        // A stage with no expectation matches nothing, so it cannot pass silently.
        expect(line, `${flag} stage ${stage.number}`).toMatch(verdicts[stage.number] ?? /^$/);
      }
      for (const notProven of NOT_PROVEN_LINES) expect(out.text(), flag).toContain(notProven);
    }
  });
});

describe('check-smtp never prints what an AUTH refusal says', () => {
  const TOKEN = Buffer.from('challenge-echo-with-a-secret-in-it', 'utf8').toString('base64');

  it('reports only the status codes and a fixed classification', async () => {
    const relay = await startFakeRelay({
      offerStartTls: true,
      authReply: `535 5.7.8 Error: authentication failed: ${TOKEN} for ${RELAY_LOGIN}`,
    });
    const out = collector();
    const err = collector();
    let code: number;
    try {
      code = await run({
        argv: ['--send', '--to', 'recipient@example.com'],
        env: { ...RELAY_ENVIRONMENT, SMTP_PORT: String(STARTTLS_PORT) },
        envFile: NO_ENV_FILE,
        transport: transportFor(relay, { called: false }),
        stdout: out.write,
        stderr: err.write,
      });
    } finally {
      await relay.close();
    }
    expect(code).toBe(1);

    const printed = out.text() + err.text();
    expect(printed).toContain('credentials rejected');
    expect(printed).toContain('SMTP 535');
    expect(printed).toContain('enhanced 5.7.8');
    expect(printed).not.toContain(TOKEN);
    expect(printed).not.toContain('authentication failed');
    expect(printed).not.toContain(RELAY_LOGIN);
    expect(printed).not.toContain(AWKWARD_MAILBOX_SECRET);
    expect(printed).toMatch(/Stage 3 {2}authentication\s+: FAIL \(credentials rejected/);
    expect(printed).toMatch(/Stage 4 {2}message acceptance by the relay\s+: NOT REACHED/);
    // No envelope follows a refused AUTH.
    expect(relay.lines.some((line) => line.toUpperCase().startsWith('MAIL FROM'))).toBe(false);
  });

  it('redacts base64-looking tokens and the configured credentials from relay text', () => {
    const redacted = redactRelayText(
      `250 2.0.0 queued as ${TOKEN}; user ${RELAY_LOGIN}; pass${AWKWARD_MAILBOX_SECRET}`,
      [AWKWARD_MAILBOX_SECRET, RELAY_LOGIN]
    );
    expect(redacted).not.toContain(TOKEN);
    expect(redacted).not.toContain(RELAY_LOGIN);
    expect(redacted).not.toContain(AWKWARD_MAILBOX_SECRET);
    expect(redacted).toContain('250 2.0.0 queued as [redacted]');
  });
});

describe('the documented relay commands name no real recipient', () => {
  it('uses a placeholder wherever --to appears in the docs, the config and the script', () => {
    const root = join(__dirname, '..', '..');
    const sources = [
      'docs/platform/environment-configuration.md',
      'supabase/config.toml',
      'scripts/dev/check-smtp.mjs',
    ];
    let seen = 0;
    for (const source of sources) {
      const text = readFileSync(join(root, source), 'utf8');
      for (const match of text.matchAll(/--send --to[ =](\S+)/g)) {
        seen += 1;
        const recipient = (match[1] ?? '').replace(/[`'",.;)]+$/, '');
        expect(recipient, `${source}: ${match[0]}`).toMatch(/^<[a-z-]+>$/);
        expect(recipient, `${source}: ${match[0]}`).not.toContain('@');
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});
