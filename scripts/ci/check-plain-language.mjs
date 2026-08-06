#!/usr/bin/env node
/**
 * The product speaks to workshop employees, not to the people who built it.
 *
 * ## Why this gate exists
 *
 * Owner-acceptance defect 9: "User-facing wording across the application still
 * assumes technical knowledge." The Product Owner's users are receptionists,
 * technicians and workshop managers. A message that says `match_basis`,
 * `recordVersion`, `null`, "payload" or `crm.customer.duplicate.review` is not
 * a message to them — it is a message to a developer, printed on their screen.
 *
 * The defect is easy to reintroduce and impossible to catch by review, because
 * the person writing the string is the person for whom the jargon reads as
 * ordinary English. This is what makes it a build failure instead.
 *
 * ## What it checks, and where
 *
 * Every VALUE in `apps/web/src/i18n/messages/{en,ar}.json`. Those two files are
 * the whole user-visible vocabulary of the product: `translate()` is the only
 * way text reaches a screen, and a string typed directly into a component is
 * already refused by the missing-key and raw-key checks.
 *
 * There are deliberately NO exemptions. An earlier draft of this gate exempted
 * the component gallery on the grounds that it is a developer surface — but it
 * is reachable from the sidebar by anyone, and an exemption list is where a
 * jargon message goes to survive. The gallery's five "API" strings were
 * rewritten instead.
 *
 * ## What it cannot check
 *
 * Whether a sentence is CLEAR. "The operation could not be completed" contains
 * no banned word and tells nobody anything. This gate removes vocabulary that is
 * definitely wrong; it cannot supply writing that is right.
 *
 * Exit: 0 clean · 1 a finding · 2 the check could not run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const CATALOGUES = ['en', 'ar'].map((locale) => ({
  locale,
  path: join('apps', 'web', 'src', 'i18n', 'messages', `${locale}.json`),
}));

/**
 * Vocabulary no workshop employee should meet.
 *
 * Each entry names what a reader would have to already know for the word to
 * mean anything. The list is the Product Owner's, extended with the specific
 * identifiers this phase's screens were caught rendering.
 */
export const RULES = [
  { id: 'json', pattern: /\bJSONB?\b/i, what: 'a data format' },
  { id: 'uuid', pattern: /\bUUIDs?\b/i, what: 'an internal identifier format' },
  { id: 'enum', pattern: /\benum(eration)?s?\b/i, what: 'a type-system word' },
  { id: 'payload', pattern: /\bpayloads?\b/i, what: 'a transport word' },
  { id: 'null', pattern: /\bnull\b/i, what: 'an absent-value keyword' },
  { id: 'boolean', pattern: /\bboolean\b/i, what: 'a type-system word' },
  { id: 'object-type', pattern: /\bobject\b/i, what: 'a type-system word' },
  { id: 'schema', pattern: /\bschemas?\b/i, what: 'a database word' },
  { id: 'endpoint', pattern: /\bendpoints?\b/i, what: 'an interface word' },
  // Case-sensitive: the acronym, not the Arabic or English words that happen to
  // contain those three letters.
  { id: 'api', pattern: /\bAPIs?\b/, what: 'an interface acronym' },
  { id: 'design-token', pattern: /\btoken layer\b|\bdesign tokens?\b/i, what: 'a styling word' },
  {
    id: 'status-code',
    pattern: /\b(HTTP|[45]\d\d error|status code)\b/i,
    what: 'a protocol detail',
  },
  { id: 'token', pattern: /\b(access|refresh|bearer|session) token\b/i, what: 'a credential word' },
  { id: 'cursor', pattern: /\b(cursor|keyset) pagination\b/i, what: 'a paging mechanism' },
  { id: 'idempotency', pattern: /\bidempoten\w*\b/i, what: 'a retry-safety word' },
  { id: 'serialise', pattern: /\bserialis\w*|\bserializ\w*/i, what: 'an encoding word' },
  { id: 'sql', pattern: /\b(SQL|PostgreSQL|Postgres|RLS)\b/i, what: 'a database technology' },
  { id: 'regex', pattern: /\bregular expression\b|\bregex\w*/i, what: 'a pattern language' },
  { id: 'tenant', pattern: /\btenants?\b/i, what: 'a platform-internal word' },
  {
    id: 'permission-code',
    pattern:
      /\b(crm|veh|iam|org|apt|rec|wo|dia|tech|qms|svc|quo|inv|sal|wty|rpt|shared)\.[a-z_]+\.[a-z_]+\b/,
    what: 'a permission code',
  },
  {
    id: 'operation-id',
    pattern:
      /\b(crm|veh|iam|org|apt|rec|wo|dia|tech|qms|svc|quo|inv|sal|wty|rpt|shared)\.[a-z]+-[a-z-]+\b/,
    what: 'an internal operation name',
  },
  {
    id: 'internal-identifier',
    // `match_basis`, `normalized_name`, `vin_collision`, `record_version`, and
    // every future sibling of theirs. Snake case is not English.
    pattern: /\b[a-z]+_[a-z_]{2,}\b/,
    what: 'an internal identifier',
  },
  {
    id: 'camel-identifier',
    // `recordVersion`, `matchBasis`, `lifecycleStatus`.
    //
    // The word must START lowercase, which is what keeps `PostgreSQL` and
    // `JSON` in their own rules and keeps every ordinary capitalised word out of
    // this one. Two letters either side of the hump, so a stray `aB` in a
    // reference or a plate format is not a finding.
    pattern: /\b[a-z]{2,}[A-Z][a-z]{2,}[a-zA-Z]*\b/,
    what: 'an internal field name',
  },
  {
    id: 'raw-key',
    // A value that IS a translation key. `translate` returns the key when a
    // message is missing, and a key pasted into the catalogue as its own value
    // makes that failure permanent and invisible to the missing-key check.
    pattern: /^[a-z][a-zA-Z]*(\.[a-zA-Z][a-zA-Z0-9]*){2,}$/,
    what: 'a raw translation key',
  },
];

export function inspect(locale, catalogue) {
  const findings = [];
  for (const [key, raw] of Object.entries(catalogue)) {
    const value = String(raw);
    for (const rule of RULES) {
      if (rule.pattern.test(value)) {
        findings.push({ locale, key, rule: rule.id, what: rule.what, value });
      }
    }
  }
  return findings;
}

/**
 * Proves the gate can still fail, and that it does not fail on ordinary prose.
 *
 * A sweep that has stopped matching reports a clean catalogue exactly like a
 * sweep that is working. This phase has shipped four sweeps that quietly matched
 * nothing, or matched only their own explanatory comments, so every sweep now
 * carries a positive control.
 */
export function selfTest() {
  const caught = inspect('test', {
    'a.b': 'The match_basis could not be read.',
    'a.c': 'This record has a stale recordVersion.',
    'a.d': 'You need crm.customer.duplicate.review to open this.',
    'a.e': 'The value is null.',
    'a.f': 'crm.customers.title',
  });
  const rules = new Set(caught.map((f) => f.rule));
  for (const expected of [
    'internal-identifier',
    'camel-identifier',
    'permission-code',
    'null',
    'raw-key',
  ]) {
    if (!rules.has(expected)) return `self-test: rule ${expected} did not fire`;
  }

  const clean = inspect('test', {
    'b.a': 'No matching customer was found.',
    'b.b': 'The same telephone number or email address is used on both records.',
    'b.c': 'Another user updated this record. Review the latest information and try again.',
    'b.d': 'Show password',
    'b.e': 'Review duplicate vehicles',
  });
  if (clean.length > 0) {
    return `self-test: ordinary business English was rejected (${clean
      .map((f) => `${f.key}:${f.rule}`)
      .join(', ')})`;
  }
  return null;
}

function main() {
  const failure = selfTest();
  if (failure) {
    console.error(failure);
    return 2;
  }

  const findings = [];
  for (const { locale, path } of CATALOGUES) {
    let catalogue;
    try {
      catalogue = JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
    } catch (error) {
      console.error(`${path} could not be read: ${String(error)}`);
      return 2;
    }
    if (Object.keys(catalogue).length === 0) {
      console.error(`${path} is empty, so this check would pass vacuously`);
      return 2;
    }
    findings.push(...inspect(locale, catalogue));
  }

  if (findings.length > 0) {
    console.error('User-facing messages that assume technical knowledge:\n');
    for (const finding of findings) {
      console.error(`  [${finding.locale}] ${finding.key}  (${finding.rule} — ${finding.what})`);
      console.error(`      ${finding.value}`);
    }
    console.error(`\n${findings.length} finding(s). Rewrite them for a workshop employee.`);
    return 1;
  }

  console.log(
    `Plain language: ${CATALOGUES.length} catalogue(s), ${RULES.length} rule(s), 0 finding(s).`
  );
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main());
}
