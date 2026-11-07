# Verify targets for the repo-state pattern. AWS/SAM commands stay in the Makefile.
# A phase is marked done in STATE.md only after its verify target passes and the
# output is pasted there.

default:
    @just --list

# lint + typecheck + test (with coverage floors) + build (what CI's check job runs, minus Lighthouse)
check:
    pnpm lint
    pnpm typecheck
    pnpm test:coverage
    pnpm build

# Phases 0 and 1: v1.0 code and security fixes, covered by the test suites
verify-phase-0: check
    cd infra && sam validate --lint

verify-phase-1: verify-phase-0

# Phase 2: repo hygiene. Lints workflows and scans git history for secrets (build output is not tracked).
verify-phase-2:
    actionlint
    gitleaks git . --config .gitleaks.toml --redact --no-banner
    ./scripts/gitleaks-config-test.sh .gitleaks.toml
    ./scripts/state-guard.sh --self-test

# Phase 3: production is live. Reads SITE_URL from the repo variable, never from code.
verify-phase-3:
    #!/usr/bin/env bash
    set -euo pipefail
    site="$(gh variable get SITE_URL)"
    curl -fsS -o /dev/null -w "web %{http_code}\n" "$site/"
    # The API is on API Gateway, not behind CloudFront: $site/v1/health would
    # get the SPA fallback (200 index.html) and pass falsely.
    api="$(aws cloudformation describe-stacks --stack-name garageborrow-prod --region us-east-2 \
      --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)"
    # Each check on its own line: under set -e a failure inside `a && b` does
    # not stop the script, so `check && echo ok` would pass silently.
    curl -fsS "$api/v1/health" | jq -e '.status == "ok"' >/dev/null
    echo "api health ok"
    # The deployed app reads its API URL from config.json; it must point at that API.
    curl -fsS "$site/config.json" | jq -e --arg api "$api" '.apiBaseUrl == $api' >/dev/null
    echo "config.json ok"
    curl -fsSI "$site/" | grep -qi '^content-security-policy:.*frame-ancestors'
    echo "security headers ok"
    gh run list --workflow deploy.yml --branch main --limit 1 --json conclusion --jq '.[0].conclusion' | grep -qx success
    echo "deploy success"

# Fail when code paths change without a STATE.md change (same check CI runs)
state-guard base="origin/main":
    ./scripts/state-guard.sh "{{base}}"
