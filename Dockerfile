# =============================================================================
# RootLco — [PRODUCT NAME — Pending Final Approval]
# Multi-stage image. P1-01-DO-002.
#
# Stages:
#   deps    - dependency installation only (best layer caching)
#   dev     - Phase 1-1 local development target (hot reload)
#   build   - produces the production build
#   runner  - production-compatible runtime (non-root, standalone)
#
# NO SECRETS ARE BAKED INTO ANY STAGE. Configuration is supplied at RUNTIME via
# environment variables. Only NEXT_PUBLIC_* values -- which are public by
# definition -- are present at build time, and only because Next.js inlines them.
# =============================================================================

# Pinned to the Node 22 LTS line on Alpine. Digest-pinning is stronger still and
# is recorded as an open hardening item in docs/phase-1/phase-1-1/security-readiness.md.
ARG NODE_VERSION=22-alpine

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# libc6-compat: some native deps expect glibc symbols on Alpine.
#
# DL3018 (hadolint, warning) wants `pkg=version` here. Not applied, for a
# recorded reason rather than a silenced one: an exact Alpine package version
# disappears from the repository on the next `node:22-alpine` patch, so pinning
# turns every base-image update into a build failure and pressures whoever hits
# it into an unreviewed bump. The composition of the image is instead known
# from evidence that describes what was ACTUALLY built — the SPDX SBOM, the
# Trivy scan of the real image, and the recorded image digest — rather than
# from a version string asserted in advance.
#
# The suppression is per line, so a NEW unpinned `apk add` anywhere in this file
# is still reported. It is not a repository-wide `.hadolint.yaml` ignore.
# hadolint ignore=DL3018
RUN apk add --no-cache libc6-compat
# Copy only the manifests first so this layer is reused unless deps change.
#
# The repository is an npm WORKSPACE with ONE root lockfile. `npm ci` validates
# every workspace manifest that lockfile references, so BOTH must be present —
# omitting either fails the install outright rather than degrading quietly.
# apps/web/package.json is here for that reason alone; no web code is built,
# copied or shipped by this image, and the runner stage below proves it.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
# `npm ci` requires the lock file and installs exactly what it pins.
#
# The full graph is installed rather than `--workspace @rootlco/api`: the API
# build resolves its own dependencies through the hoisted root node_modules, and
# a partial install would silently change WHICH copy of a shared dependency the
# build sees. What actually keeps the web tree out of the shipped image is
# `output: standalone`, which traces only the modules the API server reaches at
# runtime — a stronger guarantee than an install flag, and one the container
# gate re-checks.
RUN npm ci

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS dev
WORKDIR /app
# Same recorded reason as the first `apk add` in this file.
# hadolint ignore=DL3018
RUN apk add --no-cache libc6-compat curl
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
# Source is bind-mounted by docker-compose; node_modules comes from the image via
# a named volume so the host's OS/arch cannot poison the container's binaries.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
# `node` (uid 1000) ships with the image. Run as non-root even in development.
# /app/.next must exist and be node-owned in the IMAGE: the compose file mounts
# a named volume there, and Docker initialises a fresh volume by copying the
# image directory's contents AND ownership. Without this line the volume is
# created root-owned and the non-root dev server fails with EACCES on mkdir.
RUN mkdir -p /app/.next && chown -R node:node /app
USER node
EXPOSE 3000
# Bind 0.0.0.0 or the port is unreachable from the host.
# The CONTAINER dev server runs on webpack, not Turbopack: file-change events do
# not cross a Windows bind mount, and Turbopack has no polling fallback, so hot
# reload silently dies. webpack honours WATCHPACK_POLLING=true (set in compose)
# and polls the mounted source instead. Host-native `npm run dev` keeps Turbopack.
CMD ["npm", "run", "dev:container"]

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
# Same recorded reason as the first `apk add` in this file.
# hadolint ignore=DL3018
RUN apk add --no-cache libc6-compat
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Public build-time identity only. Never pass a secret as a build arg: build args
# are recorded in the image history and are readable by anyone with the image.
ARG NEXT_PUBLIC_APP_ENV=local
ARG NEXT_PUBLIC_APP_VERSION=0.1.0
ARG NEXT_PUBLIC_COMMIT_SHA=unknown
ENV NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV}
ENV NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION}
ENV NEXT_PUBLIC_COMMIT_SHA=${NEXT_PUBLIC_COMMIT_SHA}
# Placeholders satisfy env validation during the build. They are NOT secrets and
# are replaced at runtime; `output: standalone` does not persist them as config.
ENV NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=build-time-placeholder-not-a-secret
# Builds the API workspace only. `npm run build` delegates to @rootlco/api, so
# the emitted tree is /app/apps/api/.next and the web application is never built
# here — not as an optimisation, but because this image must not contain it.
RUN npm run build

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
# Same recorded reason as the first `apk add` in this file.
# hadolint ignore=DL3018
RUN apk add --no-cache curl
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Dedicated unprivileged user rather than reusing `node`, so the app owns nothing
# it does not need.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 --ingroup nodejs nextjs

# Remove EVERY package manager from the RUNTIME image.
#
# The container starts `node server.js`; nothing at runtime invokes a package
# manager. Keeping one leaves its dependency tree on a deployed host for no
# purpose — and that tree is not hypothetical surface: `node:22-alpine` ships
# npm bundling `brace-expansion@2.0.2`, inside the GHSA-mh99-v99m-4gvg range
# (`<=5.0.7`, patched only in 5.0.8).
#
# This list was WRONG ONCE. It deleted npm/npx only, and the image still
# carried Yarn Classic 1.22.22 at /opt/yarn-v1.22.22 plus corepack — and
# yarn's single 5.3 MB `lib/cli.js` has brace-expansion's implementation
# INLINED (escSlash/escOpen sentinels, expandTop, isAlphaSequence) together
# with `"minimatch":"^3.0.4"`. Every check written to catch this greps for a
# literal `/node_modules/<name>/` path segment, and a bundled copy has no such
# path, so all of them stayed silent. Corepack is worse than what was removed:
# it downloads and executes package managers from the network at runtime.
#
# The lesson, and the reason this deletes by BINARY rather than by package
# path: a path-based inventory cannot see vendored code. The only claim it can
# support is "no package manager is present", so that is the claim the gate
# makes and the one the risk record now states.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /usr/local/bin/corepack \
           /usr/local/bin/yarn \
           /usr/local/bin/yarnpkg \
           /opt/yarn-v* \
 && for pm in npm npx yarn yarnpkg pnpm corepack; do \
      if command -v "$pm" >/dev/null 2>&1; then \
        echo "FATAL: $pm still resolves after removal" >&2; exit 1; \
      fi; \
    done

# apk goes too. It is a package manager, it was still on PATH at /sbin/apk, and
# the container gate was printing "no package manager resolves in the production
# image" while it did — a false statement in a security gate, which is the thing
# this initiative exists to stop.
#
# Removed rather than excused: the runtime needs curl (installed above, in an
# earlier layer) and nothing else, so an OS package manager on a deployed host is
# an installer for whatever an attacker with RCE wants next.
#
# ONLY THE BINARY. `/lib/apk/db` stays, and that is not an oversight — it is the
# installed-package database Trivy reads to enumerate OS packages. Deleting it
# alongside the binary (the first attempt) left Trivy still recognising
# "alpine 3.24.1" from /etc/alpine-release while enumerating ZERO packages, so
# the OS scan reported "0 vulnerabilities" because it could see nothing:
#
#   with    /lib/apk/db : os-pkgs packages=18  vulns=0
#   without /lib/apk/db : os-pkgs packages=0   vulns=0   <- blind, looks identical
#
# A hardening step that silently disables a scanner is a net loss. The container
# job now asserts the enumerated package count is non-zero so this cannot recur.
RUN rm -f /sbin/apk \
 && for pm in npm npx yarn yarnpkg pnpm corepack apk; do \
      if command -v "$pm" >/dev/null 2>&1; then \
        echo "FATAL: $pm still resolves after removal" >&2; exit 1; \
      fi; \
    done

# `output: standalone` emits a minimal server plus only the modules the server
# actually reaches. In a workspace it preserves the repository shape, so the
# tree it emits is:
#
#   /app/apps/api/.next/standalone/apps/api/server.js   the entry point
#   /app/apps/api/.next/standalone/node_modules/…       only what server.js reaches
#
# The first COPY therefore lands `apps/api/` and `node_modules/` at the image
# root, and the two that follow put static assets and public files where the
# server expects them RELATIVE TO ITS OWN DIRECTORY. Flattening the workspace
# path here would be the obvious-looking change and would break at runtime: the
# server resolves its manifests from its own location, not from /app.
COPY --from=build --chown=nextjs:nodejs /app/apps/api/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/api/.next/static ./apps/api/.next/static
COPY --from=build --chown=nextjs:nodejs /app/apps/api/public ./apps/api/public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "apps/api/server.js"]
