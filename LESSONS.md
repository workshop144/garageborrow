# Lessons

One line per lesson, newest first.

- 2026-11-06: The repo had no STATE.md, so "is it deployed?" needed a trip through workflow runs (Deploy is always skipped). Rule: STATE.md records deploy status, and code PRs update it (CI `state-guard`).
- 2026-11-01: Dependabot opened Tailwind 3 to 4 as a plain bump (PR #30); v4 changes the config model. Rule: framework majors with migration guides get closed and done as a planned change, not auto-merged.
- 2026-09-29: Two borrowers could both take the last unit of an item. Rule: availability changes are one conditional DynamoDB transaction, and a closed garage is checked inside it (PR #20).
- 2026-09-28: Photo S3 keys embedded the uploader's phone number, so deleting an account left PII in object keys. Rule: object keys use opaque IDs only; migrate old keys with `scripts/migrate-photo-keys.ts` (PR #18).
- 2026-09-27: Cognito SignUp was open to anyone and the API trusted a caller-supplied phone. Rule: identity is the verified phone in the ID token, accounts come from invites only (PRs #12, #14).
- 2026-09-27: Data export could be emailed to any address the caller named. Rule: exports are direct downloads to the signed-in user (PR #11).
- 2026-09-27: Each OTP challenge retry sent a new SMS, costing money and enabling SMS pumping. Rule: one code per sign-in, reused across retries (PR #9).
- 2026-09-27: Presigned uploads had no size cap. Rule: sign the declared Content-Length into the URL and enforce a per-user daily quota (PRs #10, #13).
- 2026-09-26: Members could see donor and voter phone numbers. Rule: phones are visible to admins only; clear client caches on sign-out (PR #3).
- 2026-09-26: After the move to the workshop144 org, gitleaks-action needed a paid org license and two tests failed on Saturdays because they read the real clock. Rule: run the pinned gitleaks CLI, and pin the clock in any date-dependent test (PR #2).
- 2026-09-26: Tenant name, site and time zone were hard-coded, putting a real place into a public repo. Rule: per-deployment identity lives in repo variables, never in code or docs.
- 2026-04: `z.url()` accepted `javascript:` URLs, a stored XSS vector. Rule: URL fields use `HttpUrl`, rendering uses `safeHref()` (see CLAUDE.md).
- 2026-04: `actions/upload-artifact` skipped the `.lighthouse/` dot-directory and ubuntu-24.04 runners lack Chrome. Rule: set `include-hidden-files: true` and install Chrome explicitly in CI.
