#!/usr/bin/env bash
# Leak drill: prove the "Scan for committed secrets" CI check turns red.
#
# Creates a local branch drill/leak-YYYYMMDD from the default branch, commits
# drill/fake-key.txt holding a FAKE api key that matches gitleaks' built-in
# generic-api-key rule, then prints the exact push / PR / cleanup commands.
#
# It never pushes, never opens a PR and never contacts GitHub except an
# optional `git fetch` of the default branch (skip with LEAK_DRILL_NO_FETCH=1).
#
# Usage:
#   ./scripts/leak-drill.sh
#   LEAK_DRILL_NO_FETCH=1 ./scripts/leak-drill.sh   # offline, use local branch
#
# See docs/leak-drill.md for the full drill and pass threshold.
set -euo pipefail

remote="${LEAK_DRILL_REMOTE:-origin}"
branch="drill/leak-$(date +%Y%m%d)"
file="drill/fake-key.txt"

cd "$(git rev-parse --show-toplevel)"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is not clean; commit or stash first." >&2
  exit 1
fi

if git show-ref --verify --quiet "refs/heads/${branch}"; then
  echo "error: branch ${branch} already exists. Delete it first:" >&2
  echo "  git branch -D ${branch}" >&2
  exit 1
fi

# Find the default branch: origin/HEAD if known, else main.
default_branch="main"
if ref="$(git symbolic-ref --quiet --short "refs/remotes/${remote}/HEAD" 2>/dev/null)"; then
  default_branch="${ref#"${remote}/"}"
fi

base="${default_branch}"
if git remote get-url "${remote}" >/dev/null 2>&1; then
  if [[ "${LEAK_DRILL_NO_FETCH:-0}" != "1" ]]; then
    git fetch --quiet "${remote}" "${default_branch}"
  fi
  if git show-ref --verify --quiet "refs/remotes/${remote}/${default_branch}"; then
    base="${remote}/${default_branch}"
  fi
fi

git switch --quiet --no-track -c "${branch}" "${base}"

# Build the fake key at runtime from fragments so this script never contains
# a literal that trips the repo's own scan. The value is fixed (not random) so
# the drill is deterministic: random strings miss the generic-api-key rule's
# entropy/stopword filters a few percent of the time. The `api_key` keyword
# makes the rule fire. A generic key is used on purpose: provider-specific
# shapes (ghp_, AKIA...) can be blocked by GitHub push protection before CI
# ever sees them.
fake="Nq7Zr2WxLp4K""s9VdHy3Mb8Tc""Jf6Rg1QzXw5P""u0Ea"
key_name="api""_key"

mkdir -p "$(dirname "${file}")"
cat > "${file}" <<EOF
# NOT A REAL SECRET. Leak drill fixture created by scripts/leak-drill.sh.
# This made-up value exists only to prove the gitleaks CI check turns red.
# It grants access to nothing. Delete this branch after the drill.
${key_name} = "${fake}"
EOF

# Self-check when gitleaks is installed locally: the fixture must be detected.
if command -v gitleaks >/dev/null 2>&1; then
  if gitleaks dir --no-banner --redact --log-level error --exit-code 1 "$(dirname "${file}")" >/dev/null; then
    echo "error: local gitleaks did NOT flag ${file}; the drill would not turn CI red." >&2
    exit 1
  fi
  echo "Local gitleaks flags ${file} as expected."
fi

git add "${file}"
# --no-verify: a local secret-scanning hook would (correctly) refuse this
# commit; the drill is about the CI check, so local hooks are skipped here.
git commit --quiet --no-verify -m "drill: fake secret to test gitleaks CI (NOT A REAL SECRET)"

cat <<EOF

Drill commit created on local branch ${branch} (base: ${base}).
Nothing has been pushed.

1. Push the branch and open a draft PR (CI runs on pull_request):

   git push -u ${remote} ${branch}
   gh pr create --draft --base ${default_branch} --head ${branch} \\
     --title "drill: leak drill $(date +%Y-%m-%d) (do not merge)" \\
     --body "Leak drill. Expect 'Scan for committed secrets' to fail. See docs/leak-drill.md."

2. Pass: the 'Scan for committed secrets' check is red within 5 minutes.

3. Clean up (close the PR, delete remote and local branch):

   git switch ${default_branch}
   gh pr close ${branch} --delete-branch     # closes the PR, deletes remote + local branch
   # If gh is not available, or the branch is still there afterwards:
   git push ${remote} --delete ${branch}
   git branch -D ${branch}

EOF
