#!/usr/bin/env bash
# Regression test for S4-2: the repo's gitleaks config must not exempt whole
# files. Scans scratch copies of docs/deploy.md (the deploy playbook, the file
# most likely to receive a pasted credential) and another file with fake keys
# appended and fails unless gitleaks reports them, while the playbook as
# committed stays clean. It also checks that the example-key allowlist is exact.
#
# Scope: this tests the config with `gitleaks dir` on scratch copies. CI's real
# gate is `gitleaks git` from the repo root, which also honours a root
# `.gitleaksignore` and inline `gitleaks:allow` comments; those are covered only
# by the static checks below for docs/deploy.md, not exercised end to end.
#
# Usage: scripts/gitleaks-config-test.sh [CONFIG]   # default .gitleaks.toml
# Needs gitleaks and jq on PATH. Run by `just verify-phase-2` and CI's
# scan-secrets job.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config="${1:-${root}/.gitleaks.toml}"
# The documented example key in docs/deploy.md, split so no scanner sees a
# key assignment in this script.
example_key="AK""IA1234567890ABCDEF"
fails=0

pass() { echo "ok   $1"; }
fail() { echo "FAIL $1"; fails=$((fails + 1)); }

# Static guard: no path-based allowlisting anywhere in the config, global or
# per-rule, in table or inline-table form. A global allowlist's paths skip the
# file for every rule, even with condition = "AND" (gitleaks 8.30.1); a
# per-rule one hides the file from that rule. Both are banned on purpose.
# Comments are stripped first so the config's own warning does not trip it.
if sed 's/#.*//' "$config" | grep -Eq '(^|[{,[:space:]])paths[[:space:]]*='; then
  fail "config has a 'paths' allowlist entry (global or per-rule; exempts whole files, see S4-2)"
else
  pass "config has no 'paths' allowlist entry"
fi

# Static guard: no repo-root suppression of the playbook outside the config.
if [[ -f "${root}/.gitleaksignore" ]] && grep -q 'docs/deploy\.md' "${root}/.gitleaksignore"; then
  fail ".gitleaksignore has an entry for docs/deploy.md"
else
  pass ".gitleaksignore has no entry for docs/deploy.md"
fi
if grep -q 'gitleaks:allow' "${root}/docs/deploy.md"; then
  fail "docs/deploy.md has an inline gitleaks:allow"
else
  pass "docs/deploy.md has no inline gitleaks:allow"
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/gitleaks-config-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT

# Random, real-shaped fake keys built at run time, so no key-shaped literal is
# ever committed (the history scan would flag this script).
rand() { LC_ALL=C tr -dc "$1" </dev/urandom | head -c "$2" || true; }
aws_key="AK""IA$(rand 'A-Z2-7' 16)"
gh_token="gh""p_$(rand 'A-Za-z0-9' 36)"

# scan DIR [CONFIG] -> prints "file<TAB>rule" per finding, paths relative to DIR
scan() {
  local dir="$1" cfg="${2:-$config}" report="${work}/report.json" rc=0
  gitleaks dir "$dir" --config "$cfg" --no-banner --log-level error \
    --report-format json --report-path "$report" --exit-code 0 || rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "gitleaks failed (exit $rc)" >&2
    return 1
  fi
  jq -r --arg d "$(basename "$dir")" '.[] | "\(.File | sub("^.*/" + $d + "/"; ""))\t\(.RuleID)"' "$report"
}

expect() { # expect OUTPUT WANT...
  local out="$1" want
  shift
  for want in "$@"; do
    if grep -qxF "$want" <<<"$out"; then
      pass "reported: ${want//$'\t'/ }"
    else
      fail "not reported: ${want//$'\t'/ }"
    fi
  done
}

# 1. The committed playbook, plus the documented example key, scans clean.
#    This is a "no false positive" check, not a test of the allowlist: no
#    default rule matches the example key today (check 3 tests the allowlist).
mkdir -p "${work}/clean/docs"
cp "${root}/docs/deploy.md" "${work}/clean/docs/deploy.md"
# shellcheck disable=SC2016 # literal backticks, nothing to expand
printf '\nExample: `%s`\naws_access_key_id = %s\n' "$example_key" "$example_key" \
  >>"${work}/clean/docs/deploy.md"
out="$(scan "${work}/clean")"
if [[ -z "$out" ]]; then
  pass "docs/deploy.md as committed plus the example key: no findings"
else
  fail "docs/deploy.md as committed plus the example key was reported: ${out//$'\n'/; }"
fi

# 2. A pasted real-shaped key in docs/deploy.md is reported, like in any other
#    file (another doc and an arbitrary infra path).
mkdir -p "${work}/leak/docs" "${work}/leak/infra"
cp "${root}/docs/deploy.md" "${work}/leak/docs/deploy.md"
printf '\naws_access_key_id = %s\n' "$aws_key" >>"${work}/leak/docs/deploy.md"
printf 'GITHUB_TOKEN=%s\n' "$gh_token" >>"${work}/leak/docs/deploy.md"
printf 'aws_access_key_id = %s\n' "$aws_key" >"${work}/leak/other.md"
printf 'aws_access_key_id: %s\n' "$aws_key" >"${work}/leak/infra/x.yaml"
out="$(scan "${work}/leak")"
expect "$out" $'docs/deploy.md\taws-access-token' $'docs/deploy.md\tgithub-pat' \
  $'other.md\taws-access-token' $'infra/x.yaml\taws-access-token'

# 3. The allowlist itself: a scratch config adds a probe rule that does match
#    the example key. The allowlist must hide exactly the example key, not a
#    longer secret that merely contains it (the regex must stay anchored).
probe_cfg="${work}/probe.toml"
cp "$config" "$probe_cfg"
cat >>"$probe_cfg" <<'EOF'

[[rules]]
id = "example-key-probe"
description = "Test-only rule that matches the documented example key"
regex = '''AKIA[0-9A-Z]{16,}'''
EOF
mkdir -p "${work}/probe/a" "${work}/probe/b"
printf 'key = %s\n' "$example_key" >"${work}/probe/a/example.md"
printf 'key = %s%s\n' "$example_key" "$(rand 'A-Z0-9' 6)" >"${work}/probe/b/longer.md"
out="$(scan "${work}/probe" "$probe_cfg")"
if grep -q $'^a/example.md\t' <<<"$out"; then
  fail "allowlist does not suppress the example key: ${out//$'\n'/; }"
else
  pass "allowlist suppresses the example key"
fi
expect "$out" $'b/longer.md\texample-key-probe'

if [[ $fails -gt 0 ]]; then
  echo "gitleaks-config-test: ${fails} check(s) failed" >&2
  exit 1
fi
echo "gitleaks-config-test: ok"
