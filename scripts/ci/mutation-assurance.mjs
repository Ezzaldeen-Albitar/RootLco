#!/usr/bin/env node
/**
 * Targeted mutation assurance (initiative §18).
 *
 * "A removed security or integrity guard must cause a test failure."
 *
 * Coverage says a line was executed. It does not say anything would have
 * noticed if the line were wrong. This removes one guard at a time and requires
 * the suite to go red. A guard whose removal changes nothing is either dead code
 * or untested — both are findings, and both look identical to a coverage report.
 *
 * This is not a whole-repository mutation run: those take hours and produce a
 * score nobody acts on. It is a hand-picked list of the guards whose failure
 * would be a security or data-integrity incident, each with the test that is
 * supposed to catch it.
 *
 * SAFETY. The file is restored from an in-memory copy in a `finally` block, and
 * the run ends by asserting `git diff --quiet` over every touched file. If a
 * restoration ever fails, the script exits non-zero rather than leaving a
 * mutated tree behind.
 *
 * Usage:
 *   node scripts/ci/mutation-assurance.mjs --manifest .github/ci-baselines/mutation-targets.json
 * Exit codes: 0 every guard is load-bearing · 1 a surviving mutant · 2 IO/setup error.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Runs a command, returning its exit status without throwing. */
export function run(command, timeoutMs) {
  try {
    execSync(command, { stdio: 'pipe', timeout: timeoutMs, encoding: 'utf8' });
    return { status: 0, output: '' };
  } catch (error) {
    return {
      status: typeof error.status === 'number' ? error.status : 1,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`.slice(-4000),
      timedOut: error.signal === 'SIGTERM',
    };
  }
}

/**
 * Applies one mutation, runs its test, and restores the file.
 *
 * A mutant is KILLED when the test fails — that is success. A mutant SURVIVES
 * when the test still passes, which means the guard is not actually protected.
 */
export function testOneTarget(target, { timeoutMs = 900_000, dryRun = false } = {}) {
  // Read first. This function then WRITES the file it just read and restores it
  // afterwards, so an existence check followed by a read is the exact pattern
  // that leaves a mutated source on disk if the file moves in between.
  let original;
  try {
    original = readFileSync(target.file, 'utf8');
  } catch (error) {
    return { ...target, outcome: 'error', detail: `cannot read ${target.file}: ${error.message}` };
  }

  const occurrences = original.split(target.find).length - 1;
  if (occurrences === 0) {
    // A target whose anchor has moved is a silently dead check: it would report
    // "no surviving mutants" forever without ever mutating anything.
    return {
      ...target,
      outcome: 'error',
      detail:
        `the anchor text is no longer present in ${target.file}. ` +
        'The guard was renamed, moved or removed — update the target, or this check protects nothing.',
    };
  }
  if (target.expectOccurrences && occurrences !== target.expectOccurrences) {
    return {
      ...target,
      outcome: 'error',
      detail: `expected ${target.expectOccurrences} occurrence(s) of the anchor, found ${occurrences}.`,
    };
  }

  // A target may declare that it only verifies its anchor. That is a WEAKER
  // claim than a kill and is reported as such — but a target whose faithful
  // mutation has not been written yet must not fail the nightly gate every
  // night, because a permanently-red blocking job devalues every other signal
  // in the same report.
  if (dryRun || target.anchorOnly === true) {
    return {
      ...target,
      outcome: 'anchored',
      occurrences,
      detail: dryRun
        ? 'dry run — anchor verified only'
        : 'anchorOnly: the anchor is present, but this target does not yet prove the guard is load-bearing',
    };
  }

  let result;
  try {
    // `replaceAll` on purpose: a guard duplicated across read paths (the H6
    // shape) must be removed everywhere, or a second copy keeps the test green
    // and the mutant looks killed when it was never fully applied.
    writeFileSync(target.file, original.split(target.find).join(target.replace), 'utf8');
    const verdict = run(target.test, timeoutMs);
    if (verdict.timedOut) {
      result = { ...target, outcome: 'error', detail: 'the test command timed out' };
    } else if (verdict.status === 0) {
      result = {
        ...target,
        outcome: 'survived',
        occurrences,
        detail:
          'the guard was removed and the suite still passed. Either nothing asserts this behaviour, ' +
          'or the assertion that does is vacuous in the direction that matters.',
      };
    } else if (
      target.expectFailureMatching &&
      !new RegExp(target.expectFailureMatching).test(verdict.output)
    ) {
      // A non-zero exit is not by itself proof the guard was missed. A compile
      // error, a connection failure or a crash in the mutated path all exit
      // non-zero and would otherwise read as "the guard is load-bearing".
      result = {
        ...target,
        outcome: 'error',
        occurrences,
        detail:
          `the suite failed, but its output does not match \`${target.expectFailureMatching}\`, so the ` +
          'failure cannot be attributed to the removed guard. Last output:\n' +
          verdict.output.slice(-1200),
      };
    } else {
      result = { ...target, outcome: 'killed', occurrences, evidence: verdict.output.slice(-800) };
    }
  } finally {
    writeFileSync(target.file, original, 'utf8');
  }
  return result;
}

export function toMarkdown(results) {
  const killed = results.filter((r) => r.outcome === 'killed');
  const survived = results.filter((r) => r.outcome === 'survived');
  const errors = results.filter((r) => r.outcome === 'error');
  const anchored = results.filter((r) => r.outcome === 'anchored');
  const lines = ['### Mutation assurance', ''];
  if (anchored.length) {
    lines.push(
      `> ⚠️ ${anchored.length} target(s) verify their anchor only and do NOT prove the guard is ` +
        'load-bearing. They are counted separately below rather than reported as kills.'
    );
    lines.push('');
  }
  lines.push('| Outcome | Count | Meaning |');
  lines.push('| --- | --- | --- |');
  lines.push(
    `| anchored | ${anchored.length} | the anchor exists — a weaker claim than a kill, and recorded as one |`
  );
  lines.push(
    `| killed | ${killed.length} | the guard is load-bearing — removing it turns the suite red |`
  );
  lines.push(`| survived | ${survived.length} | **the guard is not protected by any test** |`);
  lines.push(
    `| error | ${errors.length} | the target could not be applied — the check protects nothing |`
  );
  lines.push('');
  lines.push('| Guard | Category | Outcome |');
  lines.push('| --- | --- | --- |');
  for (const r of results) {
    const icon = r.outcome === 'killed' ? '✅' : r.outcome === 'survived' ? '❌' : '⚠️';
    lines.push(`| \`${r.id}\` | ${r.category ?? '—'} | ${icon} ${r.outcome} |`);
  }
  if (survived.length || errors.length) {
    lines.push('');
    lines.push('**Findings**');
    lines.push('');
    for (const r of [...survived, ...errors]) {
      lines.push(
        `- ${r.outcome === 'survived' ? '❌' : '⚠️'} \`${r.id}\` (${r.file}): ${r.detail}`
      );
      if (r.why) lines.push(`  - why this guard matters: ${r.why}`);
    }
  }
  return lines.join('\n');
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const manifestPath = arg('--manifest') ?? '.github/ci-baselines/mutation-targets.json';
  if (!existsSync(manifestPath)) {
    console.error(`mutation manifest not found at ${manifestPath}`);
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const only = arg('--only');
  const targets = (manifest.targets ?? []).filter((t) => !only || t.id === only);
  if (targets.length === 0) {
    console.error(
      'no mutation targets selected — refusing to report "all guards protected" over an empty set'
    );
    process.exit(2);
  }

  const dryRun = argv.includes('--dry-run');
  const results = [];
  for (const target of targets) {
    console.log(`--- ${target.id} (${target.category ?? 'uncategorised'}) ---`);
    const result = testOneTarget(target, { dryRun });
    console.log(`    ${result.outcome}${result.detail ? `: ${result.detail}` : ''}`);
    results.push(result);
  }

  // The tree must be exactly as it was found. A mutation run that leaves a
  // mutated file behind would poison every job after it.
  const touched = [...new Set(targets.map((t) => t.file))];
  const dirty = run(`git diff --quiet -- ${touched.map((f) => `"${f}"`).join(' ')}`);
  if (dirty.status !== 0) {
    console.error(
      '::error::A mutated file was not restored. The working tree is not as it was found.'
    );
    console.error(run(`git diff --stat -- ${touched.map((f) => `"${f}"`).join(' ')}`).output);
    process.exit(2);
  }
  console.log(`OK: all ${touched.length} mutated file(s) restored byte-identically`);

  const md = toMarkdown(results);
  const mdOut = arg('--markdown');
  if (mdOut) writeFileSync(mdOut, `${md}\n`);
  const jsonOut = arg('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ results }, null, 2)}\n`);
  console.log(md);

  const failed = results.filter((r) => r.outcome === 'survived' || r.outcome === 'error');
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
