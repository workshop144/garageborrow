#!/usr/bin/env bash
# Regression test for S4-2: the repo's gitleaks config must not exempt whole
# files. Scans a scratch copy of docs/deploy.md (the deploy playbook, the file
# most likely to receive a pasted credential) with fake keys appended and fails
# unless gitleaks reports them, while the playbook as committed stays clean.
#
# Usage: scripts/gitleaks-config-test.sh [CONFIG]   # default .gitleaks.toml
# Needs gitleaks and jq on PATH. Run by `just verify-phase-2` and CI's
# scan-secrets job.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config="${1:-${root}/.gitleaks.toml}"
fails=0

pass() { echo "ok   $1"; }
fail() { echo "FAIL $1"; fails=$((fails + 1)); }

# Static guard: no path-based allowlisting anywhere in the config. A global
# allowlist's paths skip the file for every rule, even with condition = "AND"
# (gitleaks 8.30.1).
if grep -Eq '^[[:space:]]*paths[[:space:]]*=' "$config"; then
  fail "config has a 'paths' allowlist entry (exempts whole files; see S4-2)"
else
  pass "config has no 'paths' allowlist entry"
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/gitleaks-config-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT

# Random, real-shaped fake keys built at run time, so no key-shaped literal is
# ever committed (the history scan would flag this script).
rand() { LC_ALL=C tr -dc "$1" </dev/urandom | head -c "$2" || true; }
aws_key="AK""IA$(rand 'A-Z2-7' 16)"
gh_token="gh""p_$(rand 'A-Za-z0-9' 36)"

# scan DIR -> prints "file<TAB>rule" per finding, paths relative to DIR
scan() {
  local dir="$1" report="${work}/report.json" rc=0
  gitleaks dir "$dir" --config "$config" --no-banner --log-level error \
    --report-format json --report-path "$report" --exit-code 0 || rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "gitleaks failed (exit $rc)" >&2
    return 1
  fi
  jq -r --arg d "$(basename "$dir")" '.[] | "\(.File | sub("^.*/" + $d + "/"; ""))\t\(.RuleID)"' "$report"
}

# 1. The committed playbook (with the documented example key) is clean.
mkdir -p "${work}/clean/docs"
cp "${root}/docs/deploy.md" "${work}/clean/docs/deploy.md"
# shellcheck disable=SC2016 # literal backticks, nothing to expand
printf '\nExample: `AKIA1234567890ABCDEF`\naws_access_key_id = AKIA1234567890ABCDEF\n' \
  >>"${work}/clean/docs/deploy.md"
out="$(scan "${work}/clean")"
if [[ -z "$out" ]]; then
  pass "docs/deploy.md with the documented example key: no findings"
else
  fail "docs/deploy.md with the documented example key was reported: ${out//$'\n'/; }"
fi

# 2. A pasted real-shaped key in docs/deploy.md is reported, like anywhere else.
mkdir -p "${work}/leak/docs"
cp "${root}/docs/deploy.md" "${work}/leak/docs/deploy.md"
printf '\naws_access_key_id = %s\n' "$aws_key" >>"${work}/leak/docs/deploy.md"
printf 'GITHUB_TOKEN=%s\n' "$gh_token" >>"${work}/leak/docs/deploy.md"
printf 'aws_access_key_id = %s\n' "$aws_key" >"${work}/leak/other.md"
out="$(scan "${work}/leak")"
for want in $'docs/deploy.md\taws-access-token' $'docs/deploy.md\tgithub-pat' $'other.md\taws-access-token'; do
  if grep -qxF "$want" <<<"$out"; then
    pass "reported: ${want//$'\t'/ }"
  else
    fail "not reported: ${want//$'\t'/ }"
  fi
done

if [[ $fails -gt 0 ]]; then
  echo "gitleaks-config-test: ${fails} check(s) failed" >&2
  exit 1
fi
echo "gitleaks-config-test: ok"
