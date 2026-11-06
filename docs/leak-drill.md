# Leak drill: prove the secret scan turns red

The `Scan for committed secrets` check in CI (`.github/workflows/ci.yml`,
job `scan-secrets`) calls the reusable workflow `.github/workflows/gitleaks.yml`.
This drill proves that the check actually fails when a secret-shaped string is
committed, and that a clean branch stays green.

Time needed: about 5 minutes.

## Pass threshold

The drill passes when **both** are true:

1. On the drill PR, `Scan for committed secrets / gitleaks` is **red within
   5 minutes of the push**, and the log shows `leaks found: 1` for
   `drill/fake-key.txt` (rule `generic-api-key`, value shown as `REDACTED`).
2. On a clean branch (any normal PR opened in the same window, or the latest
   run on `main`), the same check is **green**.

Anything else is a fail: the check is green on the drill PR, takes longer than
5 minutes to finish, or a clean branch turns red. Record the result (date, PR
number, minutes to red) wherever you keep drill notes.

## Run it

From an up-to-date clone with a clean working tree:

```bash
./scripts/leak-drill.sh
```

The script:

- creates the local branch `drill/leak-YYYYMMDD` from the default branch
  (it runs `git fetch origin main` first; set `LEAK_DRILL_NO_FETCH=1` to skip),
- writes `drill/fake-key.txt` with a made-up `api_key = "..."` line, clearly
  marked **NOT A REAL SECRET**, built at runtime so the script itself does not
  trip the scan,
- if `gitleaks` is installed locally, checks that it flags the file,
- commits with `--no-verify` (a local secret-scanning hook would rightly block
  the commit; this drill tests CI, not local hooks),
- prints the exact push, PR and cleanup commands. **It never pushes.**

Then run the printed commands. CI runs on `pull_request` (and on pushes to
`main`), so the drill needs a draft PR, not only a pushed branch:

```bash
git push -u origin drill/leak-YYYYMMDD
gh pr create --draft --base main --head drill/leak-YYYYMMDD \
  --title "drill: leak drill YYYY-MM-DD (do not merge)" \
  --body "Leak drill. Expect 'Scan for committed secrets' to fail. See docs/leak-drill.md."
```

If a local pre-push guard refuses the push because it found the fake key, that
is the local layer working. Note it, then push with `git push --no-verify ...`
on purpose to continue the CI part of the drill.

Watch the check with `gh pr checks --watch` or in the PR's Checks tab.

The fake key does not match GitHub push-protection patterns (it is a generic
key, not a `ghp_`/`AKIA` shape), so GitHub should accept the push and leave the
job to gitleaks.

## Clean up

```bash
git switch main
gh pr close drill/leak-YYYYMMDD --delete-branch   # closes PR, deletes remote + local branch
# Without gh, or if the branch is still there:
git push origin --delete drill/leak-YYYYMMDD
git branch -D drill/leak-YYYYMMDD
```

Never merge the drill PR. Do **not** add `drill/` to the `.gitleaks.toml`
allowlist: the drill relies on the default rules catching it.

The closed PR keeps its commit reachable on GitHub (`refs/pull/N/head`). That
is fine because the value is fake, but do not reuse the drill branch name for
real work.

## Why other PRs stay green during the drill

`actions/checkout` with `fetch-depth: 0` fetches every branch, and plain
`gitleaks git` scans `git log --all`. The reusable workflow therefore scans
`--log-opts="--full-history HEAD"`: the full history reachable from the
checked-out commit (for a PR, the merge of base and head). The drill branch
only turns its own PR red.
