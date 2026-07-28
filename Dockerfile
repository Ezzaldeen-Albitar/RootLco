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
COPY package.json package-lock.json ./
# `npm ci` requires the lock file and installs exactly what it pins.
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

# Remove npm from the RUNTIME image.
#
# The container starts `node server.js`; nothing at runtime invokes a package
# manager. Keeping npm would leave its bundled dependency tree on a deployed
# host for no purpose — and that tree is not hypothetical surface: the
# `node:22-alpine` npm ships `brace-expansion@2.0.2`, which is inside the
# GHSA-mh99-v99m-4gvg range (`<=5.0.7`, patched only in 5.0.8).
#
# Found by the container job's own image inventory, which reported
# brace-expansion and minimatch present in the production image while `/app`
# was clean. Deleting npm makes the exception record's
# `finalContainerReachable: false` literally true rather than a claim that
# quietly meant "not in OUR dependency tree".
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx

# `output: standalone` emits a minimal server plus only the deps it actually uses.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
