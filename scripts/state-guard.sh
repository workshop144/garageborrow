#!/usr/bin/env bash
# Fail when code paths change without a STATE.md change.
#
# Usage:
#   scripts/state-guard.sh [BASE_REF] [HEAD_REF]   # defaults: origin/main HEAD
#   scripts/state-guard.sh --self-test
#
# Escape hatch: set STATE_GUARD_TITLE to the PR title (CI does this). A title
# starting with chore or deps (for example "chore(deps): ...") skips the check.
set -euo pipefail

code_re='^(apps|packages|infra|scripts)/|^\.github/workflows/'
escape_re='^(chore|deps)(\([^)]*\))?!?:'

decide() {
  # stdin: changed file list; $1: title. Prints the verdict, returns 1 on fail.
  local title="$1" files code
  files="$(cat)"
  if [[ "$title" =~ $escape_re ]]; then
    echo "state-guard: skipped (title starts with chore/deps)"
    return 0
  fi
  code="$(grep -E "$code_re" <<<"$files" || true)"
  if [[ -z "$code" ]]; then
    echo "state-guard: ok (no code paths changed)"
    return 0
  fi
  if grep -qx 'STATE.md' <<<"$files"; then
    echo "state-guard: ok (STATE.md updated)"
    return 0
  fi
  echo "state-guard: code paths changed but STATE.md did not:" >&2
  sed 's/^/  /' <<<"$code" >&2
  echo "Update STATE.md in the same PR, or title it chore:/deps: if it changes nothing worth recording." >&2
  return 1
}

if [[ "${1:-}" == "--self-test" ]]; then
  printf 'apps/api/src/index.ts\n' | decide "fix: x" >/dev/null 2>&1 && { echo "self-test: code without STATE should fail" >&2; exit 1; }
  printf 'apps/api/src/index.ts\nSTATE.md\n' | decide "fix: x" >/dev/null
  printf 'apps/api/src/index.ts\n' | decide "chore(deps): bump" >/dev/null
  printf 'README.md\n' | decide "docs: x" >/dev/null
  echo "state-guard: self-test ok"
  exit 0
fi

base="${1:-origin/main}"
head="${2:-HEAD}"
git diff --name-only "$base...$head" | decide "${STATE_GUARD_TITLE:-}"
