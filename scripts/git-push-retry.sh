#!/usr/bin/env bash
# Push a branch to origin, retrying transient SSH failures.
# Network access to github.com:22 in this environment is intermittent: some
# connections are accepted in ~2s, others time out. Retry until the remote ref
# is actually observed -- never assume a push succeeded from exit code alone.
set -uo pipefail
BRANCH="${1:?usage: git-push-retry.sh <branch> [attempts]}"
ATTEMPTS="${2:-6}"
export GIT_SSH_COMMAND="ssh -o ConnectTimeout=30 -o ServerAliveInterval=15"

confirmed() {
  timeout 60 git ls-remote --heads origin 2>/dev/null | grep -q "refs/heads/${BRANCH}$"
}

for i in $(seq 1 "$ATTEMPTS"); do
  if confirmed; then
    echo "CONFIRMED: origin/${BRANCH} present (before attempt ${i})"
    exit 0
  fi
  echo "--- push attempt ${i}/${ATTEMPTS}: ${BRANCH}"
  timeout 150 git push -u origin "${BRANCH}" 2>&1 | tail -3
  if confirmed; then
    echo "CONFIRMED: origin/${BRANCH} present after attempt ${i}"
    exit 0
  fi
  sleep 3
done

echo "FAILED: origin/${BRANCH} not confirmed after ${ATTEMPTS} attempts"
exit 1
