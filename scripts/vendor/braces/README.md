# braces — local patched copy (GHSA-vfj7-8cjw-p6xm)

This directory holds a local copy of the npm package `braces` and the patch RootLco applies to it.
It is repository tooling, not product code. No file from it ships in the API runtime image.

## Provenance

| Field                 | Value                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| Package               | `braces` (MIT), by Jon Schlinkert and contributors, `https://github.com/micromatch/braces`        |
| Upstream version      | `3.0.3` (latest release; published to npm on 2024-05-21; git tag `3.0.3`, commit `74b2db29`)      |
| Source tarball        | `https://registry.npmjs.org/braces/-/braces-3.0.3.tgz`                                            |
| Registry integrity    | `sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==` |
| Registry shasum       | `490332f40919452272d55a8480adc0c441358789`                                                        |
| `braces-3.0.3.tgz`    | the registry tarball, byte for byte; its sha512 equals the registry integrity above               |
| `LICENSE`             | the upstream licence file, copied unchanged from the tarball                                      |
| Local patched version | `3.0.3-rootlco.1` — a local label, not an upstream release                                        |

## Why this copy exists

GHSA-vfj7-8cjw-p6xm (CVE-2026-93687, high, CWE-674): braces up to and including 3.0.3 has recursive
AST walkers without a depth limit. A deeply nested brace pattern under the 10,000-character input
limit exhausts the call stack and the Node.js process ends with an uncaught `RangeError`. The
advisory lists no patched version (`first_patched_version` is null on 2026-10-03), the upstream fix
proposal (micromatch/braces PR #72, for issue #70) is not merged, and no package that depends on
braces has dropped it or pinned a fixed release.

The Owner approved a patched in-repository copy on 2026-10-03, subject to implementation evidence and
independent review.

## Ownership

RootLco owns the patch and its maintenance until the replacement condition below is met. The
upstream authors are not responsible for the patch.

## Replacement condition

Replace this copy with the first official braces release that fixes GHSA-vfj7-8cjw-p6xm, or remove
it when no dependency needs braces. Removing it means deleting this directory, the root
`devDependencies` and `overrides` entries for `braces`, the Dockerfile `COPY` line for the tarball
and `tests/ci/braces-patched-copy.test.ts`, then regenerating `package-lock.json` with npm.

## Full record

The dependency paths, reachability findings, patch description, limitations and scanner coverage
are recorded in `docs/engineering/dependency-maintenance/ghsa-vfj7-8cjw-p6xm-braces/README.md`.
