import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The whole failed-submit reset class, enumerated rather than spot-checked.
 *
 * ## Why a class-wide check and not five more cases
 *
 * `NEW-FE-01` was diagnosed correctly and then fixed five separate times, each
 * instance found by attacking the previous fix: the `select` inside
 * `RecordForm`, its `checkbox` eleven lines below, and three screens that own
 * their own `<form action={…}>` and never received it — one of which carries a
 * comment stating that the hole exists "wherever a `<select>` sits in a
 * `<form action={…}>`".
 *
 * Five rounds of finding the same defect somewhere new is not five defects. It
 * is one defect and no inventory. This file is the inventory.
 *
 * ## The shape that is safe, and why the obvious one is not
 *
 * React resets the form DOM once a Server Action settles. A controlled `value`
 * that is unchanged between renders is never re-written by the reconciler, so
 * the reset wins — measured, and recorded at `CustomerCreateScreen.tsx:197-207`
 * ("Making it a controlled `value={…}` field … DID NOT FIX IT").
 *
 * What works is three parts together: a `key` on the attempt counter to force a
 * remount, `defaultValue`/`defaultChecked` seeded from state — which is what
 * `form.reset()` restores TO — and `onChange` to keep that state current.
 *
 * ## The first version of this scan reported 0 uncovered while three real
 * ## defects sat in files it never opened
 *
 * That version scoped itself to text lexically between `<form action={` and
 * `</form>` **in the same file**, and `continue`d past any file with no literal
 * form. An adversarial review found what that skipped:
 *
 *   - `VehicleRelationsSections.tsx` — six controlled `checked=` scope
 *     checkboxes, rendered into `RecordForm`'s form through `prelude`. A failed
 *     write un-ticked all six while state kept them, so the retry passed the
 *     client scope guard and was rejected by the server for an empty scope.
 *   - `CustomerSelector.tsx` — the party-type filter reverted to "Any type"
 *     while `draft.partyType` kept the old value, so the next search was still
 *     restricted to companies while the control said it was not.
 *   - `VehicleCreateScreen.tsx` — `CatalogueSelect` is defined AFTER `</form>`,
 *     so its correct shape was never inspected either.
 *
 * `prelude` exists precisely to render foreign controls inside a form, so
 * "lexically inside a form element in one file" is a strictly smaller set than
 * "rendered inside a form" — and the difference is where the defects were.
 *
 * ## So the default is inverted: every control is reset-sensitive until proven
 * ## otherwise
 *
 * "Is this rendered inside a form?" is not decidable by reading one file, and a
 * scanner that guesses will guess wrong in the direction that hides defects. So
 * EVERY `<select>`, checkbox, radio and textarea in the scanned trees must carry
 * the safe shape, unless its file:line is listed in `OUTSIDE_A_FORM` with a
 * reason. An exemption is then a visible, reviewable line in a diff rather than
 * a silent gap in a regex.
 *
 * ## Round six — the scan was complete over a tree that was no longer the tree
 *
 * Every rule above was sound and this suite passed 6/6 while four more real
 * defects sat in files it never opened: the cancellation reason on an
 * IRREVERSIBLE lifecycle command, the appointment-type picker, the
 * company/branch pair that is the authorization TARGET of every booking, and
 * the approval-limit subject. `ROOTS` named eight trees; the application owns
 * twenty-one `<form action={…}>` files spread across eleven. The inventory was
 * not wrong about what it read — it was reading half the subject, and an
 * inventory of half a thing reports zero for the other half just as loudly.
 *
 * Two things follow from that, and only the second of them is a fix:
 *
 *   - **`ROOTS` is no longer trusted, it is CHECKED.** `covers every tree in
 *     src that owns a form` re-derives the form-owning set from the whole of
 *     `src` with this file's own `OWNS_FORM` test and fails if any of it falls
 *     outside the roots. A form added to a new feature turns this suite red
 *     until the root joins the list, which is the only version of "the scanner
 *     covers everything" that survives the next feature.
 *   - **"Rendered into a form" is DERIVED, not listed.** A file whose exported
 *     component is rendered by a file that is itself inside a form is inside a
 *     form too, transitively. `BranchTargetFields` owns no form, renders no
 *     `RecordForm` and passes no `prelude`; it is reached by that edge alone,
 *     and the two selects it holds are the authorization target of every
 *     appointment this product books. A hand list would have needed somebody to
 *     think of it first, which is precisely what did not happen five times.
 *
 * Comments are stripped first. An earlier version reported ZERO checkboxes in a
 * file that has one, because a docblock sat between `<input` and its attributes.
 */

const SRC = join(process.cwd(), 'src');

/**
 * How a file declares that a form reset can happen inside it.
 *
 * `<form` followed by ANY attribute order — the old `/<form\s+action=\{/`
 * missed `<form className="…" action=…>` entirely. Deliberately NOT global:
 * a `g` regex carries `lastIndex` between calls, and this one is tested against
 * every file in `src` twice.
 *
 * `action={…}` and not `onSubmit={…}` is the whole distinction. React resets the
 * form DOM after a **Server Action** settles; a form that prevents its own
 * default and calls a handler is never reset, and demanding the safe shape there
 * would be ritual rather than rule.
 */
const OWNS_FORM = /<form\b[^>]*\baction=\{/;

/**
 * Every tree that owns a `<form action={…}>`, checked below rather than trusted.
 *
 * This list said eight trees while the application owned twenty-one form files
 * across eleven, and the four defects of round six all sat in the three that
 * were missing. It is kept by hand because a scan cannot know which trees are
 * IN this phase's remit — but `covers every tree in src that owns a form`
 * re-derives the form-owning set from the whole of `src` and fails the moment
 * one of them is not under a root here.
 */
const ROOTS = [
  join(SRC, 'features', 'crm'),
  join(SRC, 'features', 'vehicles'),
  // P1-28: the reception intake flow renders forms of exactly this class
  // (a lifecycle select and a powertrain select inside `<form action={…}>`),
  // so its tree joins the inventory rather than repeating the five-round
  // history that built it.
  join(SRC, 'features', 'receptions'),
  // P1-28, round six: appointment booking, the appointment detail lifecycle
  // commands, and the company/branch authorization target all own or feed a
  // `<form action={…}>` and none of them had ever been opened by this scan.
  join(SRC, 'features', 'appointments'),
  // Approval limits, roles, users and the tenant form — four more form owners,
  // shipped in P1-26 and never inventoried.
  join(SRC, 'features', 'administration'),
  // Sign-in, forgotten password, set password, the profile form and the account
  // menu. Text and password boxes today, which is exactly the state in which a
  // tree gets left out and then grows a select.
  join(SRC, 'features', 'authentication'),
  // P1-29 W4: the technician workspace binds work evidence through a
  // `<form action={…}>` — a category select, two text boxes and the file input —
  // so its tree joins the inventory the round-six check demands.
  join(SRC, 'features', 'technicians'),
  join(SRC, 'components', 'forms'),
  join(SRC, 'components', 'party'),
  join(SRC, 'components', 'duplicates'),
  join(SRC, 'components', 'data-table'),
  join(SRC, 'app'),
];

/**
 * Which control types the reset can actually strand, read off React's DOM code
 * and then MEASURED — because the two disagreed, and the code won.
 *
 *   - **text input / textarea — controlled is SAFE, UNCONTROLLED IS NOT.**
 *     `updateInput` and `updateTextarea` re-assign the node's `defaultValue`
 *     on every commit, so `form.reset()` restores to the value React just
 *     wrote. That is true, and it is only true of a CONTROLLED control: React
 *     never commits a value for one it does not own, so an uncontrolled text
 *     box or textarea has whatever default it was born with — usually none —
 *     and the reset empties it.
 *   - **select — controlled is NOT safe.** The update path calls
 *     `updateOptions(…, false)`, which re-applies `selected` and never
 *     `defaultSelected`; `defaultSelected` is written at mount only.
 *   - **checkbox / radio — controlled is NOT safe.** `updateInput` assigns
 *     `defaultChecked` only when `checked` is nullish, so a controlled
 *     checkbox's default is frozen at its MOUNT value — `false`, normally.
 *
 * ## What this file used to say, and what it cost
 *
 * The paragraph above ended "so a control that needs the safe shape is a
 * select, a checkbox or a radio. Text and textarea are inventoried but not
 * required to carry it." The premise was right about CONTROLLED text and the
 * conclusion was applied to EVERY text control, so `RESET_STRANDS` excluded a
 * kind that really loses the operator's typing. Measured, on the shipped field
 * components, in a form whose Server Action refuses:
 *
 *     BEFORE {"text":"typed by the operator","area":"a note the operator wrote","select":"b"}
 *     AFTER  {"text":"",                     "area":"",                        "select":"a"}
 *
 * An uncontrolled text box and an uncontrolled textarea are emptied exactly
 * like a select. (The select reverts to its FIRST option, not to empty — a
 * detail worth stating, because a screen with no placeholder option shows a
 * plausible wrong value rather than an obviously blank one.)
 *
 * So the strand set is every kind whose value the reset can take. What differs
 * between them is not WHETHER they are guarded but WHAT counts as guarded, and
 * `safeShape` below states that per kind rather than in one sentence for all.
 */
const RESET_STRANDS: readonly Control['kind'][] = [
  'select',
  'checkbox',
  'radio',
  'text',
  'textarea',
];

/**
 * What the safe shape IS, per kind. The difference is measured, not stylistic.
 *
 *   - `select` / `checkbox` / `radio` — an EPOCH `key` + `default*` +
 *     `onChange`. A controlled `value=`/`checked=` does NOT survive, which the
 *     case below proves separately so this rule cannot quietly relax into
 *     accepting one.
 *   - `text` / `textarea` — EITHER controlled (`value=`, which React re-commits
 *     as the default and which the measurement above shows surviving) OR the
 *     same epoch `key` + `defaultValue` + `onChange` shape. What is refused is
 *     the third case: neither, i.e. an uncontrolled box holding whatever the
 *     operator typed and nothing to restore it from.
 *
 * ## "Epoch", and which strand actually depends on it
 *
 * A `key` only does anything when it CHANGES — React reuses a node with the
 * same key. This rule read `/\bkey=/`, presence, so `key="x"` satisfied the one
 * part of the shape a select genuinely depends on while providing nothing.
 * `resetKeyOf` now judges the EXPRESSION against the settlement signals of the
 * control’s own file.
 *
 * `form-reset-runtime.dom.test.tsx` measures the consequence on the shipped
 * components, in a real form, against a real refusal, with a bare input as a
 * canary so "the value is still there" is only read once the reset has run:
 *
 *     epoch key     → text kept, textarea kept, select kept
 *     constant key  → text kept, textarea kept, select REVERTED to option one
 *     no key        → text kept, textarea kept, select REVERTED to option one
 *     epoch key, constant default → all three LOST
 *
 * So the strand the key is load-bearing for is the SELECT: React’s
 * `updateSelect` applies `defaultValue` at mount only — on an update with no
 * `value` prop and an unchanged `multiple` it applies nothing — while
 * `updateInput`/`updateTextarea` re-assign `node.defaultValue` on every commit.
 * A checkbox with a state-tracking `defaultChecked` behaves like the text ones.
 *
 * The epoch key is nonetheless required of every strand, and that is a stated
 * CONVENTION rather than a claim that each one would otherwise break. One
 * shape across the tree is what makes a call site readable without knowing
 * which React internal governs it — and the alternative, a rule that exempts
 * three kinds, is how a select comes to be written like the checkbox beside it.
 * The last line of the table is why the default matters as much: an epoch key
 * over a literal default remounts faithfully to a value nobody typed.
 */
function safeShape(c: Control): boolean {
  /*
   * The key must CHANGE, not merely exist. This read `/\bkey=/` — presence —
   * which is the one part of the three-part shape a select actually depends
   * on, and the part a constant key satisfies while doing nothing.
   */
  const keyed = c.resetKey.kind === 'epoch';
  const defaulted = /\bdefault(Value|Checked)=/.test(c.head);
  // A spread carries the handler in a shared field component's own definition.
  const changes = /\bonChange=/.test(c.head) || /\{\.\.\.\w+\}/.test(c.head);
  const controlled = /\bvalue=/.test(c.head);

  if (c.kind === 'text' || c.kind === 'textarea') {
    return controlled || (keyed && defaulted && changes);
  }
  return keyed && defaulted && changes;
}

/**
 * The two edges by which a control ends up inside a form it cannot see.
 *
 * `HANDS_CONTROLS_TO_A_FORM` is the UPWARD edge: a file that renders
 * `<RecordForm` or passes a `prelude={` is putting its own controls inside
 * `RecordForm`'s form. `RENDERED_INTO_A_FORM` is a hand-written SEED, kept as
 * belt and braces for a composition no regex could see.
 *
 * The downward edge — a form owner rendering somebody else's component — is
 * derived by `reachedByAFormReset` below and is the one that mattered in round
 * six. `CustomerSelector` is still seeded here, and `follows a component into
 * the form that renders it` proves the derived edge carries its own weight
 * rather than riding on this list.
 */
/**
 * Password controls that INTENTIONALLY clear when a submission is refused.
 *
 * A password box is the one control where losing the value on a refusal is
 * defensible rather than a defect, so `password` is not in `RESET_STRANDS`.
 * That silence is exactly the shape this file has been bitten by twice, so the
 * decision is written down per call site instead: the list below is the policy,
 * and the case `records a decision for every password control` refuses any
 * password control inside a form that is not named here.
 *
 * It is deliberately NOT "every password field is exempt". A flow that promised
 * retry retention — a wizard step re-validating a password already typed, say
 * — would have to argue for it here, in front of a reader, rather than inherit
 * an exemption from the control’s type.
 */
const CLEARS_ON_REFUSAL: readonly { file: string; match: string; why: string }[] = [
  {
    file: 'features/authentication/components/LoginForm.tsx',
    match: '<PasswordField',
    why: 'Sign-in. A refused sign-in is the case where the password was most likely mistyped, and re-typing it is the intended correction. Retaining it would also leave the secret in a live DOM node across a failed attempt on a shared reception desk. The EMAIL beside it is retained — that is the half that was a defect, and it is fixed.',
  },
  {
    file: 'features/authentication/components/SetPasswordForm.tsx',
    match: '<PasswordField',
    why: 'Choosing a new password, both boxes — the password and its confirmation. Every refusal this form can produce is a statement about the value itself (too short, too common, the two do not match), so restoring the rejected value would restore precisely what was refused and invite the operator to submit it again unchanged.',
  },
];

const RENDERED_INTO_A_FORM: readonly string[] = ['components/party/CustomerSelector.tsx'];
const HANDS_CONTROLS_TO_A_FORM = /<RecordForm\b|\bprelude=\{/;

/** How a file names a component another file can render. */
const EXPORTS_COMPONENT =
  /export\s+(?:default\s+)?function\s+([A-Z]\w*)|export\s+const\s+([A-Z]\w*)/g;
/** How a file renders one. Lowercase tags are DOM elements, not components. */
const RENDERS_COMPONENT = /<([A-Z]\w*)/g;

/**
 * Controls the reset provably cannot reach, exempt with a stated reason. Each
 * must still match exactly one control, so an exemption cannot rot into one that
 * protects nothing.
 *
 * The name is the one the failure message below tells a reader to look for. It
 * used to be `EXEMPT` while the diagnostic said `OUTSIDE_A_FORM`, which sent
 * whoever read it looking for an identifier that did not exist.
 */
const OUTSIDE_A_FORM: readonly { file: string; match: string; why: string }[] = [
  {
    file: 'components/forms/Field.tsx',
    match: '<select id={controlId}',
    why: 'A shared primitive. It spreads the caller’s props onto the element, so it cannot supply its own key or default — the CALL SITE carries them, and the call sites are inventoried here too.',
  },
  {
    file: 'components/forms/Field.tsx',
    match: '<input id={controlId} type="checkbox"',
    why: 'The same primitive argument as the select above: `CheckboxField` forwards whatever the caller passes.',
  },
  {
    file: 'components/forms/Field.tsx',
    match: '<input id={id} type="radio"',
    why: 'The same primitive argument. `RadioGroupField` renders one input per option from the caller’s props.',
  },
  {
    file: 'components/forms/Field.tsx',
    match: '<input id={controlId} aria-describedby={describedBy}',
    why: 'The same primitive argument as the select and checkbox above: `TextField` spreads the caller’s props onto the element, so the key and the default belong to the CALL SITE — and every call site is inventoried here, which is what this pass added.',
  },
  {
    file: 'components/forms/Field.tsx',
    match: "<input id={controlId} type={revealed ? 'text' : 'password'}",
    why: '`PasswordField`’s own element. Whether a password box retains its value after a refusal is a product decision rather than a shape one, and it is recorded per call site in `CLEARS_ON_REFUSAL` — this entry exempts the shared primitive, not the decision.',
  },
  {
    file: 'components/forms/Field.tsx',
    match: '<textarea id={controlId} rows={4}',
    why: 'The same primitive argument. `TextAreaField` forwards whatever the caller passes, and the caller is where a `key` can change.',
  },
  {
    file: 'features/receptions/components/CaptureFileField.tsx',
    match: '<input type="file"',
    why: 'A file input CANNOT carry a default. Browsers refuse a programmatic write to `input[type=file].value` — that is the guard against a page selecting a file the operator never chose — so `defaultValue` is not a shape this control can take. What a reset costs here is the file selection, which the operator re-makes deliberately; there is no typed text to strand.',
  },
  {
    file: 'features/technicians/components/TechnicianWorkspaceScreen.tsx',
    match: "<SelectField label={translate(messages, 'technicians.workspace.company')}",
    why: 'The branch-target company picker (P1-29 W4). It sits in a `<form onSubmit={…}>` that prevents its own default and sets state — never a Server Action, so React never resets it. The only `<form action={…}>` in this tree is the evidence capture in `JobWorkPanel.tsx`, which this screen renders as a SIBLING of the target form, not inside it — read off the element nesting.',
  },
  {
    file: 'features/technicians/components/TechnicianWorkspaceScreen.tsx',
    match: "<SelectField label={translate(messages, 'technicians.workspace.branch')}",
    why: 'The branch-target branch picker, the other half of the same pair, in the same `onSubmit` form for the same reason.',
  },
  {
    file: 'features/vehicles/components/VehicleDuplicateReviewScreen.tsx',
    match: '<select value={status}',
    why: 'The queue status filter. It drives a table read and sits above the review form as a sibling, so no form reset reaches it — confirmed by reading the element nesting, not inferred from the file.',
  },
  {
    file: 'components/data-table/DataTable.tsx',
    match: '<select value={request.pageSize}',
    why: 'The shared table’s page-size control, at `DataTable.tsx:586`. The table is a SIBLING of every form that appears beside it — the derived reachability reaches this file because a form owner renders `<DataTable`, not because the table is inside the form — and its request state is owned by `useServerTable`, which no form reset touches.',
  },
  {
    file: 'features/administration/users/components/UsersScreen.tsx',
    match: "<SelectField label={t('users.filter.status')}",
    why: 'The user-list status filter at `UsersScreen.tsx:177`, rendered in `UsersScreen` above the table. The only `<form action={…}>` in this file belongs to `InviteDialog`, a separate component mounted in a dialog, so the filter is not inside it — read off the element nesting rather than inferred from the file owning a form somewhere.',
  },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * Blanks comments while preserving BOTH length and line structure.
 *
 * The previous version replaced a whole block comment with spaces, newlines
 * included, so a multi-line docblock collapsed into one line and every reported
 * line number after it was wrong — a control at line 370 was reported at 322.
 * Byte offsets stayed correct, which is why the assertions still worked and only
 * the diagnostics lied. Newlines are kept.
 */
function stripComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

/**
 * The end of a JSX opening tag — the `>` that closes it, not the first `>` in
 * the file.
 *
 * `src.indexOf('>', at)` truncated every head at the first arrow function, so
 * `onChange={() => …}` cut the head short and everything after it was invisible
 * to every rule below. Braces are tracked so an expression's `>` cannot end the
 * tag; `/>` and `>` both terminate it at depth zero.
 */
function tagEnd(src: string, at: number): number {
  let depth = 0;
  for (let i = at; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return i;
  }
  return Math.min(src.length, at + 1200);
}

interface Control {
  readonly kind: 'select' | 'checkbox' | 'radio' | 'textarea' | 'text' | 'password';
  readonly file: string;
  readonly line: number;
  readonly head: string;
  /** Whether a form reset can reach it — see `reachedByAFormReset`. */
  readonly inForm: boolean;
  /** The `key` this control was written with, judged — see `resetKeyOf`. */
  readonly resetKey: ResetKey;
}

/**
 * What a control’s `key` actually is, rather than whether one is present.
 *
 * A remount is the whole mechanism: React reuses a node with the same key,
 * re-runs `updateOptions(…, false)` on it, and the operator’s selection is gone.
 * The remount only happens if the key CHANGED, so `key="x"` — a key that can
 * never change — provides exactly nothing while satisfying a presence check.
 * That is not hypothetical: mounted in a real form with a real refusing Server
 * Action, three shipped controls carrying a constant key plus a default plus an
 * `onChange` lost their values exactly as unkeyed ones did.
 */
interface ResetKey {
  readonly kind: 'absent' | 'literal' | 'static' | 'epoch';
  /** The expression as written, for the failure message. */
  readonly text: string;
}

/**
 * The values in a FILE that change when a Server Action settles.
 *
 * Derived per file rather than hard-coded, for the reason every other
 * hand-listed set in this repository has already failed: a list of blessed
 * names answers for the components somebody remembered. What is looked for is
 * the shape the settlement really has here — the state a form binds from
 * `useActionState`/`useState<ActionState>`, and the `attempt` a parent hands a
 * child that cannot see the state itself.
 */
function settlementSignals(src: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const m of src.matchAll(
    /const\s*\[\s*(\w+)\s*[,\]][^=]*=\s*(?:useActionState|useFormState)\s*\(/g
  )) {
    names.add(m[1]!);
  }
  for (const m of src.matchAll(
    /const\s*\[\s*(\w+)\s*,\s*\w+\s*\]\s*=\s*useState<\s*ActionState[^>]*>/g
  )) {
    names.add(m[1]!);
  }
  /*
   * A child component is handed the epoch as a prop, because it cannot see the
   * state that produced it. Both spellings the tree uses are accepted — a
   * declared prop and a destructured one — and neither is assumed: the file has
   * to actually carry it.
   */
  if (/\battempt\s*[?:,}]/.test(src) || /\battempt\b\s*=/.test(src)) names.add('attempt');
  return names;
}

/** The text of a JSX attribute value, brace- and template-aware. */
function attributeValue(head: string, name: string): string | null {
  const at = new RegExp('\\b' + name + '=').exec(head);
  if (!at) return null;
  const start = (at.index ?? 0) + at[0].length;
  const opener = head[start];
  if (opener === '"' || opener === "'") {
    const end = head.indexOf(opener, start + 1);
    return head.slice(start, end === -1 ? head.length : end + 1);
  }
  if (opener !== '{') return null;
  let depth = 0;
  for (let i = start; i < head.length; i += 1) {
    if (head[i] === '{') depth += 1;
    else if (head[i] === '}') {
      depth -= 1;
      if (depth === 0) return head.slice(start, i + 1);
    }
  }
  return head.slice(start);
}

/**
 * Judge one control’s key against the settlement signals of its own file.
 *
 * Four answers, because the three failures are different and a reader of a
 * failure needs to know which: no key at all, a string literal, an expression
 * that cannot change, and a key that carries the epoch.
 */
function resetKeyOf(head: string, signals: ReadonlySet<string>): ResetKey {
  const raw = attributeValue(head, 'key');
  if (raw === null) return { kind: 'absent', text: '' };
  if (raw.startsWith('"') || raw.startsWith("'")) return { kind: 'literal', text: raw };

  const inner = raw.slice(1, -1).trim();
  // `key={'x'}` and `key={`x`}` are literals wearing braces.
  if (/^(['"])[^'"]*\1$/.test(inner)) return { kind: 'literal', text: raw };

  for (const signal of signals) {
    if (new RegExp('\\b' + signal + '\\b').test(inner)) return { kind: 'epoch', text: raw };
  }
  return { kind: 'static', text: raw };
}

/**
 * What each shared field wrapper IS, from the caller's side.
 *
 * `SelectField` renders a `<select>` and `TextAreaField` a `<textarea>`, and
 * the caller is where the key and the default have to live — but a scan looking
 * only for a lowercase `<select` cannot see any of them. The application uses
 * the wrappers almost exclusively: 70 `<TextField>` call sites against 27 raw
 * `<input>` of text kind, so a matcher naming only three wrappers left the
 * majority of every text control in the tier uninventoried.
 *
 * `PasswordField` is listed so it is SEEN. What happens to it is decided by
 * `CLEARS_ON_REFUSAL` rather than by the shape rule — see that list.
 */
const COMPONENT_KIND = {
  SelectField: 'select',
  CheckboxField: 'checkbox',
  RadioGroupField: 'radio',
  TextField: 'text',
  TextAreaField: 'textarea',
  PasswordField: 'password',
} as const;

/** One file, read once, with everything the reachability closure needs. */
interface Scanned {
  readonly file: string;
  readonly src: string;
  readonly ownsForm: boolean;
  readonly exports: ReadonlySet<string>;
  readonly renders: ReadonlySet<string>;
}

function scanFile(path: string): Scanned {
  const src = stripComments(readFileSync(path, 'utf8'));
  const exported = new Set<string>();
  for (const m of src.matchAll(EXPORTS_COMPONENT)) exported.add((m[1] ?? m[2]) as string);
  const rendered = new Set<string>();
  for (const m of src.matchAll(RENDERS_COMPONENT)) rendered.add(m[1] as string);
  return {
    file: path.slice(SRC.length + 1).replace(/\\/g, '/'),
    src,
    ownsForm: OWNS_FORM.test(src),
    exports: exported,
    renders: rendered,
  };
}

/**
 * Which files a form reset can reach, closed transitively.
 *
 * The seeds are the three things a single file can say about itself: it owns a
 * `<form action={…}>`, it hands its controls to one, or it is named in the seed
 * list. The closure then follows the edge no single file states — **a file that
 * is inside a form renders somebody else's component, so that component is
 * inside the form as well**, and so on through whatever that component renders.
 *
 * ## Why a component NAME is enough of an edge
 *
 * The alternative is resolving import specifiers to paths, which buys precision
 * this rule does not want. Two files exporting the same component name both
 * become reachable; that over-approximates, and over-approximating is the safe
 * direction here — the cost is one line in `OUTSIDE_A_FORM` with a reason a
 * reviewer can weigh, while the cost of under-approximating is round seven.
 *
 * It also does not care WHERE in the parent the child is rendered. "Lexically
 * between `<form action={` and `</form>`" is the exact reasoning that produced
 * the first version of this scan, and `DataTable` — a genuine sibling — is the
 * only false positive it produces across twenty-one form owners.
 */
function reachedByAFormReset(scanned: readonly Scanned[]): ReadonlySet<string> {
  const definedIn = new Map<string, string[]>();
  for (const one of scanned) {
    for (const name of one.exports) definedIn.set(name, [...(definedIn.get(name) ?? []), one.file]);
  }
  const byFile = new Map(scanned.map((one) => [one.file, one]));

  const inForm = new Set(
    scanned
      .filter(
        (one) =>
          one.ownsForm ||
          HANDS_CONTROLS_TO_A_FORM.test(one.src) ||
          RENDERED_INTO_A_FORM.includes(one.file)
      )
      .map((one) => one.file)
  );

  const queue = [...inForm];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    for (const name of byFile.get(file)?.renders ?? []) {
      for (const target of definedIn.get(name) ?? []) {
        if (!inForm.has(target)) {
          inForm.add(target);
          queue.push(target);
        }
      }
    }
  }
  return inForm;
}

function inventory(): {
  files: string[];
  forms: string[];
  controls: Control[];
  scanned: Scanned[];
} {
  const paths = ROOTS.flatMap((root) => {
    try {
      return walk(root);
    } catch {
      return [];
    }
  });

  const scanned = paths.map(scanFile);
  const reachable = reachedByAFormReset(scanned);
  const forms = scanned.filter((one) => one.ownsForm).map((one) => one.file);
  const controls: Control[] = [];

  for (const { file, src } of scanned) {
    const inForm = reachable.has(file);
    // Judged against THIS file’s own settlement signals, not a global list.
    const signals = settlementSignals(src);

    /*
     * Component-level controls. `SelectField` and `CheckboxField` ARE a select
     * and a checkbox from the caller's side, and the caller is where the key and
     * the default have to live — but a scan looking only for a lowercase
     * `<select` cannot see them.
     *
     * Proved necessary by mutation: reverting `CustomerSelector`'s party-type
     * filter to a controlled `value=` left this file green, because the control
     * it renders is `<SelectField>`.
     */
    for (const m of src.matchAll(
      /<(SelectField|CheckboxField|RadioGroupField|TextField|TextAreaField|PasswordField)\b/g
    )) {
      const at = m.index ?? 0;
      const head = src.slice(at, tagEnd(src, at));
      const line = src.slice(0, at).split('\n').length;
      const kind = COMPONENT_KIND[m[1] as keyof typeof COMPONENT_KIND];
      controls.push({ kind, file, line, head, inForm, resetKey: resetKeyOf(head, signals) });
    }

    for (const m of src.matchAll(/<(select|textarea|input)\b/g)) {
      const at = m.index ?? 0;
      const head = src.slice(at, tagEnd(src, at));
      const line = src.slice(0, at).split('\n').length;
      const tag = m[1];
      if (tag === 'select' || tag === 'textarea') {
        controls.push({ kind: tag, file, line, head, inForm, resetKey: resetKeyOf(head, signals) });
      } else {
        // `type="checkbox"` and `type={…}` both count — the old scan read only
        // the literal form, so a computed type was invisible.
        const literal = /type="(\w+)"/.exec(head)?.[1];
        if (literal === 'checkbox' || literal === 'radio') {
          controls.push({
            kind: literal,
            file,
            line,
            head,
            inForm,
            resetKey: resetKeyOf(head, signals),
          });
        } else if (/type=\{/.test(head)) {
          /*
           * A computed type. Read the literals the expression can produce —
           * `type={field.kind === 'number' ? 'number' : 'text'}` can never be a
           * checkbox — and fall back to the STRICTER branch when none is
           * legible, because guessing "text" would exempt a control nobody
           * has read.
           */
          const expression = /type=\{([\s\S]*?)\}/.exec(head)?.[1] ?? '';
          const literals = [...expression.matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
          const strandable =
            literals.length === 0 || literals.some((l) => l === 'checkbox' || l === 'radio');
          controls.push({
            kind: strandable ? 'checkbox' : 'text',
            file,
            line,
            head,
            inForm,
            resetKey: resetKeyOf(head, signals),
          });
        } else {
          controls.push({
            kind: 'text',
            file,
            line,
            head,
            inForm,
            resetKey: resetKeyOf(head, signals),
          });
        }
      }
    }
  }
  return { files: scanned.map((one) => one.file), forms, controls, scanned };
}

const { files, forms, controls, scanned } = inventory();
/** The files a form reset can reach, shared by the wiring cases below. */
const FORM_REACHABLE = reachedByAFormReset(scanned);

/**
 * Collapse whitespace before matching an exemption. Prettier decides where a
 * JSX tag wraps, so an exemption written on one line would silently stop
 * matching the moment the file was reformatted — and an exemption that matches
 * nothing means the control quietly re-enters the guarded set, or, worse, that
 * the "matches exactly one" case below is the only thing that notices.
 */
const flat = (s: string) => s.replace(/\s+/g, ' ');

const exempt = (c: Control) =>
  OUTSIDE_A_FORM.some((e) => e.file === c.file && flat(c.head).includes(flat(e.match)));

/**
 * Every control the safe shape applies to: reachable by a form reset, of a kind
 * the reset can strand, and not explicitly exempted with a reason.
 */
const guarded = controls.filter((c) => c.inForm && RESET_STRANDS.includes(c.kind) && !exempt(c));

describe('every reset-sensitive control in the form-owning trees is protected', () => {
  it('scans real files and finds forms and controls, so nothing below is vacuous', () => {
    expect(files.length, 'the scan opened no files at all').toBeGreaterThan(60);
    expect(forms.length, 'no form was found').toBeGreaterThanOrEqual(20);
    expect(guarded.length, 'no reset-sensitive control was found').toBeGreaterThanOrEqual(10);
    for (const kind of ['select', 'checkbox'] as const) {
      expect(
        guarded.some((c) => c.kind === kind),
        `no ${kind} is in the inventory — comments are hiding it again`
      ).toBe(true);
    }
  });

  it('covers every tree in src that owns a form, so ROOTS cannot silently under-cover', () => {
    /*
     * The round-six failure, made structural. `ROOTS` listed eight trees while
     * the application owned twenty-one `<form action={…}>` files across eleven,
     * and every assertion below was perfectly true about the third of the
     * product it could see.
     *
     * So the form-owning set is re-derived here from the WHOLE of `src`, with
     * the same `OWNS_FORM` test the inventory uses, and every one of them must
     * fall under a root. This is the assertion that has to fail before anybody
     * can ship a form into a tree nobody inventoried.
     */
    const owners = walk(SRC).filter((path) =>
      OWNS_FORM.test(stripComments(readFileSync(path, 'utf8')))
    );
    expect(
      owners.length,
      'the re-derivation found no `<form action={…}>` at all, so this check examined nothing'
    ).toBeGreaterThanOrEqual(20);

    const uncovered = owners
      .filter((path) => !ROOTS.some((root) => path === root || path.startsWith(root + sep)))
      .map((path) => path.slice(SRC.length + 1).replace(/\\/g, '/'));

    expect(
      uncovered,
      'a file owns a `<form action={…}>` and no ROOT contains it, so its controls are not inventoried. ' +
        'Add the tree to ROOTS — do not narrow this check.'
    ).toEqual([]);
  });

  it('follows a component into the form that renders it, not just the file that owns one', () => {
    /*
     * Non-vacuity for the derived edge, on the file that proves it: the
     * company/branch pair is the authorization target of every booking, it owns
     * no form, hands controls to none, and is in no hand-written list. If the
     * closure ever stops running, this is the assertion that says so — rather
     * than the inventory quietly reporting zero uncovered controls again.
     */
    const target = 'features/appointments/components/BranchTargetFields.tsx';
    const src = stripComments(readFileSync(join(SRC, ...target.split('/')), 'utf8'));

    expect(OWNS_FORM.test(src), `${target} owns a form, so it proves nothing here`).toBe(false);
    expect(
      HANDS_CONTROLS_TO_A_FORM.test(src),
      `${target} states the upward edge itself, so it proves nothing here`
    ).toBe(false);
    expect(RENDERED_INTO_A_FORM.includes(target), `${target} is seeded by hand`).toBe(false);

    expect(
      guarded.some((c) => c.file === target),
      `${target} is reachable only by the derived edge and contributes no guarded control — the closure is not running`
    ).toBe(true);
  });

  it('reaches the files the first version of this scan skipped entirely', () => {
    /*
     * Named, because "the scanner covers everything now" is exactly the kind of
     * claim this phase keeps finding to be false. Three of these four files
     * contained a defect the previous scan reported zero of, and it reported
     * zero because it never opened them.
     *
     * `CustomerSelector` renders its filter through `SelectField`, so it is
     * checked here by REACHABILITY — the file is in the scan and in
     * `RENDERED_INTO_A_FORM` — while the control shape is enforced at the
     * `SelectField` call site by the `attempt` case below.
     */
    for (const required of [
      'components/party/CustomerSelector.tsx',
      'components/forms/Field.tsx',
      'features/vehicles/components/VehicleRelationsSections.tsx',
      'features/vehicles/components/VehicleCreateScreen.tsx',
    ]) {
      expect(
        files.some((f) => f.replace(/\\/g, '/') === required),
        `${required} is not in the scan at all`
      ).toBe(true);
    }
    /*
     * And the round-six four, named for the same reason: each held a confirmed
     * defect while this scan reported zero, because `ROOTS` did not contain the
     * tree. Naming them means a root removed by a future tidy-up fails HERE,
     * with the file that stops being inventoried, rather than silently.
     */
    for (const required of [
      'features/vehicles/components/VehicleRelationsSections.tsx',
      'features/vehicles/components/VehicleCreateScreen.tsx',
      'features/appointments/components/AppointmentDetailScreen.tsx',
      'features/appointments/components/AppointmentBookingScreen.tsx',
      'features/appointments/components/BranchTargetFields.tsx',
      'features/administration/access/components/ApprovalLimitsScreen.tsx',
    ]) {
      expect(
        guarded.some((c) => c.file === required),
        `${required} contributes no guarded control — the scan is not reading it`
      ).toBe(true);
    }
  });

  it('protects every one with the safe shape for its kind', () => {
    // A shared field component receives its props by spread; the control it
    // renders is inspected at its own definition, and the CALL SITE is what
    // must carry the key. Both are in the inventory, so both are checked.
    const uncovered = guarded
      .filter((c) => !safeShape(c))
      .map((c) => `${c.kind} ${c.file}:${c.line} — ${c.head.replace(/\s+/g, ' ').slice(0, 80)}`);

    expect(
      uncovered,
      'a control inside a form will lose the operator’s choice when the write fails. ' +
        'If it is genuinely outside a form, add it to OUTSIDE_A_FORM with a reason.'
    ).toEqual([]);
  });

  it('records a decision for every password control, and cannot become a generic hole', () => {
    /*
     * `password` is absent from `RESET_STRANDS`, which means the shape rule
     * says nothing about it. Left there, that is an omission indistinguishable
     * from an oversight — the class of thing this file exists to stop. So every
     * password control a form reset can reach must be NAMED in
     * `CLEARS_ON_REFUSAL` with a reason, and the reason is checked for being a
     * reason rather than a word.
     */
    const passwords = controls.filter((c) => c.kind === 'password' && c.inForm);

    // Anti-vacuity: the tier really has password controls, and they really are
    // inside forms. A rule over an empty set is satisfied by anything.
    expect(passwords.length, 'no password control was inventoried').toBeGreaterThanOrEqual(3);

    const undecided = passwords
      .filter(
        (c) =>
          !CLEARS_ON_REFUSAL.some((e) => e.file === c.file && flat(c.head).includes(flat(e.match)))
      )
      .map((c) => `${c.file}:${c.line}`);
    expect(
      undecided,
      'a password control inside a form has no recorded decision. Add it to CLEARS_ON_REFUSAL ' +
        'with the product reason it is allowed to clear — or give it the safe shape.'
    ).toEqual([]);

    for (const entry of CLEARS_ON_REFUSAL) {
      // Each entry must match at least one real control, so an exemption cannot
      // rot into one that protects nothing after the control it named moved.
      const matched = passwords.filter(
        (c) => c.file === entry.file && flat(c.head).includes(flat(entry.match))
      );
      expect(
        matched.length,
        `${entry.file} — CLEARS_ON_REFUSAL entry matches no control`
      ).toBeGreaterThan(0);
      expect(entry.why.length, `${entry.file} — the reason is too short to be one`).toBeGreaterThan(
        80
      );
    }

    /*
     * And the list is confined to passwords. Without this, the cheapest way
     * past a failing shape check would be to add the offending control here —
     * which is how an exemption list becomes the defect.
     */
    for (const entry of CLEARS_ON_REFUSAL) {
      const nonPassword = controls.filter(
        (c) =>
          c.file === entry.file && c.kind !== 'password' && flat(c.head).includes(flat(entry.match))
      );
      expect(
        nonPassword,
        `${entry.file} — CLEARS_ON_REFUSAL covers a control that is not a password`
      ).toEqual([]);
    }
  });

  it('keeps the EMAIL beside a password guarded — the half that was a defect', () => {
    /*
     * The password policy is narrow on purpose. A sign-in that refuses should
     * not make the operator re-type the address they got right, and this is the
     * assertion that stops the exemption spreading from the secret to the form
     * around it.
     */
    for (const file of [
      'features/authentication/components/LoginForm.tsx',
      'features/authentication/components/ForgotPasswordForm.tsx',
    ]) {
      const emails = controls.filter((c) => c.file === file && c.kind === 'text' && c.inForm);
      expect(emails.length, `${file} contributes no text control`).toBeGreaterThan(0);
      for (const control of emails) {
        expect(safeShape(control), `${file}:${control.line} — the address is not retained`).toBe(
          true
        );
      }
    }
  });

  it('refuses a controlled value, which was measured NOT to survive the reset', () => {
    /*
     * The trap is that `value=` + `onChange` LOOKS correct and is what a reviewer
     * would ask for. It was tried, measured, and recorded as not working:
     * "after submit state=active dom=prospect".
     */
    /*
     * `value` means different things on different controls, and conflating them
     * produced a false positive on a correct control: on a checkbox `value=` is
     * the string SUBMITTED when it is ticked — required, and nothing to do with
     * state — while `checked=` is the controlled prop. On a select, `value=` IS
     * the controlled prop.
     */
    const controlled = guarded
      .filter((c) =>
        c.kind === 'select'
          ? /\bvalue=\{/.test(c.head) && !/\bdefaultValue=/.test(c.head)
          : /\bchecked=\{/.test(c.head) && !/\bdefaultChecked=/.test(c.head)
      )
      .map((c) => `${c.kind} ${c.file}:${c.line}`);

    expect(
      controlled,
      'a controlled prop unchanged between renders is not re-written, so the reset wins'
    ).toEqual([]);
  });

  it('keeps every exemption real, named and reachable', () => {
    // An exemption for a control that no longer exists has stopped describing
    // the tree, and would protect nothing while reading as deliberate. Each must
    // still match exactly one control, and carry a reason a reader can weigh.
    for (const entry of OUTSIDE_A_FORM) {
      // `flat` on BOTH sides, exactly as `exempt()` does it. This line matched
      // on the raw head while `exempt()` matched on the flattened one, so an
      // exemption could be live and simultaneously reported as matching nothing.
      const matched = controls.filter(
        (c) => c.file === entry.file && flat(c.head).includes(flat(entry.match))
      );
      expect(
        matched.length,
        `OUTSIDE_A_FORM entry matches ${matched.length} controls: ${entry.file} / ${entry.match}`
      ).toBe(1);
      expect(entry.why.length, `${entry.file} exemption carries no reason`).toBeGreaterThan(40);
    }
    for (const file of RENDERED_INTO_A_FORM) {
      expect(
        files.some((f) => f.replace(/\\/g, '/') === file),
        `RENDERED_INTO_A_FORM names ${file}, which the scan does not see`
      ).toBe(true);
    }
  });

  it('refuses a key that cannot change, in every spelling of one', () => {
    /*
     * The defect this replaced, as a table of the forms it takes. Each of these
     * satisfied the old presence check and provides no remount, so a select
     * carrying one loses the operator’s choice on every refusal.
     *
     * Judged against a file that really has a settlement signal, so a rejection
     * here is about the KEY and not about a file with nothing to key on.
     */
    const signals = settlementSignals('const [state, act] = useActionState(save, IDLE);');
    expect([...signals]).toContain('state');

    const REFUSED = [
      { head: '<SelectField key="x" defaultValue={v} onChange={h} />', kind: 'literal' },
      { head: "<SelectField key={'x'} defaultValue={v} onChange={h} />", kind: 'literal' },
      {
        head: '<SelectField key={STATIC_CONSTANT} defaultValue={v} onChange={h} />',
        kind: 'static',
      },
      { head: '<SelectField key={field.name} defaultValue={v} onChange={h} />', kind: 'static' },
      { head: '<SelectField defaultValue={v} onChange={h} />', kind: 'absent' },
    ] as const;

    for (const refused of REFUSED) {
      const judged = resetKeyOf(refused.head, signals);
      expect(judged.kind, refused.head).toBe(refused.kind);
      expect(
        safeShape({
          kind: 'select',
          file: 'x.tsx',
          line: 1,
          head: refused.head,
          inForm: true,
          resetKey: judged,
        }),
        refused.head
      ).toBe(false);
    }
  });

  it('accepts the epoch shapes the tree really writes, and only those', () => {
    /*
     * The other half. A rule that rejects everything is as useless as one that
     * accepts everything, and these are read off the shipped call sites rather
     * than invented: a template literal over the action state’s attempt, the
     * same over an `attempt` prop a parent handed down, and a stringified
     * snapshot of what was last committed.
     */
    const stateFile = settlementSignals('const [state, setState] = useState<ActionState>(IDLE);');
    const propFile = settlementSignals('function F({ attempt }: { attempt: number }) {');

    const ACCEPTED = [
      {
        head:
          '<SelectField key={' +
          '`limitType-${state.attempt ?? 0}`' +
          '} defaultValue={v} onChange={h} />',
        signals: stateFile,
      },
      {
        head: '<SelectField key={' + '`purpose-${attempt}`' + '} defaultValue={v} onChange={h} />',
        signals: propFile,
      },
    ] as const;

    for (const accepted of ACCEPTED) {
      const judged = resetKeyOf(accepted.head, accepted.signals);
      expect(judged.kind, accepted.head).toBe('epoch');
      expect(
        safeShape({
          kind: 'select',
          file: 'x.tsx',
          line: 1,
          head: accepted.head,
          inForm: true,
          resetKey: judged,
        }),
        accepted.head
      ).toBe(true);
    }
  });

  it('derives the settlement signals from the file rather than from a blessed list', () => {
    /*
     * The failure mode a hand-listed set of names has, stated as a case: a form
     * that binds its state under any other name is still a form, and its keys
     * still have to change. What is looked for is the SHAPE — a binding from
     * `useActionState`/`useState<ActionState>`, or an `attempt` handed down.
     */
    expect([...settlementSignals('const [saveState, act] = useActionState(save, IDLE);')]).toEqual([
      'saveState',
    ]);
    expect([
      ...settlementSignals('const [outcome, setOutcome] = useState<ActionState>(IDLE);'),
    ]).toEqual(['outcome']);

    // A file with no settlement at all offers nothing to key on, so no key in it
    // can be an epoch — which is the fail-closed direction.
    expect([...settlementSignals('const rows = useMemo(() => [], []);')]).toEqual([]);
    expect(
      resetKeyOf(
        '<SelectField key={' + '`a-${b}`' + '} />',
        settlementSignals('const rows = useMemo(() => [], []);')
      ).kind
    ).toBe('static');
  });
  it('requires every in-form CustomerSelector to be told a REAL attempt', () => {
    /*
     * `CustomerSelector` renders its own party-type `<select>`, which this scan
     * checks at the definition. But the remount depends on a value the CALLER
     * supplies, so a call site that omits `attempt` reintroduces the defect
     * without changing the component. That is the wiring half, and it is the
     * half this phase has repeatedly shipped missing.
     *
     * ## Two corrections, both from the same round
     *
     * The check was `/\battempt=/` — presence — which is the identical defect the
     * key check carried: `attempt={0}` is a prop that can never change and so
     * remounts nothing. The value is now judged against the settlement signals
     * of the calling file, the same judgement `resetKeyOf` makes.
     *
     * And it is scoped to selectors a reset can REACH, which the title always
     * claimed and the code never did — it walked every file. Tightening the
     * value check without that scope turns the case red on
     * `WalkInIntakeScreen`, whose selector sits in a `<section>` and hands its
     * choice straight to a callback: no `<form action={…}>` encloses it, nothing
     * resets it, and `attempt={0}` there is an accurate statement that there is
     * no attempt rather than a missed wiring. Demanding an epoch of it would be
     * a prop describing nothing, which is what this file exists to tell apart.
     * Move it into a form and the reachability derivation puts it back in scope.
     */
    const sites: string[] = [];
    for (const root of ROOTS) {
      let paths: string[];
      try {
        paths = walk(root);
      } catch {
        continue;
      }
      for (const path of paths) {
        const src = stripComments(readFileSync(path, 'utf8'));
        const file = path.slice(SRC.length + 1).replace(/\\/g, '/');
        if (!FORM_REACHABLE.has(file)) continue;
        const signals = settlementSignals(src);
        for (const m of src.matchAll(/<CustomerSelector\b/g)) {
          const at = m.index ?? 0;
          const end = src.indexOf('/>', at);
          const head = src.slice(at, end === -1 ? at + 700 : end);
          /*
           * The VALUE, not the presence of the prop. `attempt={0}` is a prop
           * that describes nothing and would have satisfied `/\battempt=/`,
           * which is the same defect the key check carried.
           */
          const passed = attributeValue(head, 'attempt');
          const wired =
            passed !== null &&
            passed.startsWith('{') &&
            [...signals].some((signal) => new RegExp('\\b' + signal + '\\b').test(passed));
          if (!wired) {
            sites.push(`${file}:${src.slice(0, at).split('\n').length}`);
          }
        }
      }
    }
    expect(
      sites,
      'a CustomerSelector a form reset reaches, with no attempt that can change'
    ).toEqual([]);

    /*
     * Non-vacuity, because the scope filter above could silently empty this
     * case: some selectors ARE in scope, and the ones that are carry an epoch.
     */
    const inScope = scanned.filter(
      (one) => FORM_REACHABLE.has(one.file) && one.src.includes('<CustomerSelector')
    );
    expect(
      inScope.length,
      'the reachability filter matched no CustomerSelector at all, so this case proved nothing'
    ).toBeGreaterThan(0);
  });

  it('requires every BranchTargetFields in a Server-Action form to be told the attempt', () => {
    /*
     * The same wiring half, for the company/branch pair. `BranchTargetFields`
     * renders the AUTHORIZATION TARGET of every appointment read and every
     * booking — the one field where a value the operator cannot see being sent
     * is a scope decision made on their behalf — and its remount depends on a
     * counter only the caller holds.
     *
     * ## Why this one is scoped to form OWNERS and the selector's is not
     *
     * `AppointmentCalendarScreen` renders the same component inside a
     * `<form onSubmit={…}>`. React resets the form DOM after a Server Action
     * settles; a form that prevents its own default and calls a handler is
     * never reset, so there is nothing there for an `attempt` to survive.
     * Demanding one would be a prop that describes nothing, and this file's
     * whole subject is the difference between a rule and a ritual.
     */
    const sites: string[] = [];
    for (const one of scanned) {
      if (!one.ownsForm) continue;
      const signals = settlementSignals(one.src);
      for (const m of one.src.matchAll(/<BranchTargetFields\b/g)) {
        const at = m.index ?? 0;
        const end = one.src.indexOf('/>', at);
        const head = one.src.slice(at, end === -1 ? at + 700 : end);
        // The same value-not-presence rule as the selector above.
        const passed = attributeValue(head, 'attempt');
        const wired =
          passed !== null &&
          passed.startsWith('{') &&
          [...signals].some((signal) => new RegExp('\\b' + signal + '\\b').test(passed));
        if (!wired) {
          sites.push(`${one.file}:${one.src.slice(0, at).split('\n').length}`);
        }
      }
    }
    expect(
      sites,
      'a BranchTargetFields inside a `<form action={…}>` with no `attempt` prop'
    ).toEqual([]);
  });
});
