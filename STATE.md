# Current Build State

Last updated: 2026-11-06 by Claude (agent): bug-fix sweep of 17 verified findings in loans, notifier, idempotency, donations, cleaner and resizer (branch `fix/bugs-2026-11-06`); production deploy has never run.

## Phase status

- [x] Phase 0: v1.0 build (prompts 1 to 12 in [docs/build-prompts.md](docs/build-prompts.md))
- [x] Phase 1: security hardening (audit runs 1 to 3, PRs #3, #9 to #14, #17 to #20)
- [x] Phase 2: repo hygiene and supply chain (Dependabot via n0, gitleaks, leak drill script)
- [ ] Phase 3: first production deploy (BLOCKED on operator, see below)
- [ ] Phase 4: real-device smoke test and launch ([docs/smoke-test.md](docs/smoke-test.md))
- [ ] Phase 5: Phase B features (deferred, no target date)

## What is true now

- pnpm monorepo: `apps/web` (Vite React PWA), `apps/api` (Hono on Lambda, plus `notifier`, `image-resizer`, `account-cleaner` and Cognito custom-auth triggers), `packages/shared` (Zod schemas, DynamoDB keys, tier logic), `packages/ui`, `infra/template.yaml` (SAM, us-east-2).
- Local checks on 2026-11-06 on `fix/bugs-2026-11-06`: lint, typecheck clean; tests 119 shared + 235 api + 136 web = 490 passing; `pnpm build` ok. (Earlier at `4fc36db`: 438 passing; `sam validate --lint` valid. infra/ unchanged since.)
- Auth is phone-only via Cognito custom auth. Accounts are created by invite only (no self-service SignUp, PR #14). The caller's identity is the verified phone from the ID token (PR #12). One SMS per sign-in, the code is reused across challenge retries (PR #9).
- Uploads: presigned URL signs the declared size (PR #10), per-user daily quota (PR #13), photo keys no longer carry phone numbers; `scripts/migrate-photo-keys.ts` migrates old keys (PR #18).
- Data export is a direct download, never emailed (PR #11). Members never see donor or voter phones (PR #3).
- Loans: last-unit commit is atomic and a closed garage blocks borrowing (PR #20).
- Loan lifecycle (fix/bugs-2026-11-06): loan rows carry a `rev` and every replace is conditional on it (`updateLoan(next, prev)`). Only the borrower can claim a return, once; an owner dispute removes the claim so the unit counts as out again. The notifier cron auto-confirms undisputed claims older than 48h (`lib/loan-lifecycle.ts`), skips reminders for claimed loans, and settles member counters on time vs late; owner returns settle counters too and accept overdue loans. Extensions go through the availability check and the item lock, max 3 per loan. `duration_days` is capped at 60.
- Approval-required borrows and reservations notify the owner (`borrow_request_pending`); the owner lists them at `GET /admin/reservations` and decides with `POST /admin/reservations/:id/decide`. The web app has no screen for this yet.
- `waitlist_unblocked` now fires on owner return, cron auto-confirm and an item going back to available.
- Notifier cron: garage discovery follows Scan pages; each garage and reminder is isolated (logged, Sentry, `counts.failures`); the dedup slot is claimed before sending and released only if nothing went out.
- Idempotency keys are claimed before the handler (conditional in-progress marker, 60 s) and scoped by method and path. Donation accept is one TransactWrite conditional on `pending`. Photo keys must match `uploads/...` (API) and the web renders only such keys. Malformed JSON is a 400.
- Account cleaner resets counters first, queries the user partition, and retries BatchWrite UnprocessedItems. The image resizer rethrows transient errors so the async retry and its DLQ apply.
- Wishlist (request and vote on missing gear) shipped in the original v1.0 history, even though the README listed it under Phase B.
- Tenant name, site URL, time zone, governing law, venue and garage slug are GitHub repository variables, never code (`46e89fe`). Do not copy their values into repo files.
- CI (`.github/workflows/ci.yml`): lint, typecheck, test, build, Lighthouse, plus `scan-secrets` via the reusable `.github/workflows/gitleaks.yml` (PR #36). `state-guard` checks that code PRs update STATE.md (added 2026-11-06).
- `security-review.yml` is wired for same-repo PRs but skips with a notice: the `ANTHROPIC_API_KEY` repo secret is not set (verified on the PR #36 run). The local `/security-review` step in CLAUDE.md is the only review that actually runs. Setting the key would bill API credits, not a Claude plan, so it stays an operator decision.
- Dependabot weekly, grouped minor/patch and majors per ecosystem (ADR-089 in workshop144/sublevel); n0's merger squash-merges green PRs. Tailwind 4 landed via the grouped majors PR #33 (CSS-first `@import "tailwindcss"`, `@tailwindcss/postcss`).
- pnpm 12 (`packageManager` in package.json). pnpm settings live in `pnpm-workspace.yaml` (pnpm 11+ ignores the `pnpm` field of package.json): `minimumReleaseAge` 3 days to match the Dependabot cooldown, `allowBuilds` (only esbuild may run install scripts), and the eslint-plugin-react peer override. The release-age check also runs on `pnpm install --frozen-lockfile`, so a Dependabot security PR for a release under 3 days old fails CI and n0 will not merge it. Accepted: for an urgent CVE fix, add the package to `minimumReleaseAgeExclude` in that PR (see the comment in `pnpm-workspace.yaml`).
- TypeScript stays on 6.x: TS 7 (native compiler) has no JS compiler API and typescript-eslint 8.72 peers `typescript <6.1`. Revisit when typescript-eslint supports 7.
- `deploy.yml` is gated on `vars.DEPLOY_ENABLED == 'true'`, which is unset, so every Deploy run is `skipped`. Nothing is live in AWS from this repo.
- `just check` runs lint, typecheck, test, build; `just verify-phase-N` targets exist for phases 0 to 3. On 2026-11-06 `just verify-phase-0` passed (template valid, all suites green) and `just verify-phase-2` passed (actionlint clean, `gitleaks git` no leaks, state-guard self-test ok).

## Open / BLOCKED

- BLOCKED (operator): Phase 3 first deploy. Needs, in order: domain and Route 53 hosted zone, ACM cert in us-east-1, an AWS OIDC deploy role saved as repo secret `AWS_DEPLOY_ROLE_ARN`, a `production` environment, then repo variable `DEPLOY_ENABLED=true`. Also Cognito SMS production approval (sandbox limits SMS to verified numbers), VAPID keypair (`scripts/gen-vapid.ts`), AWS Budgets alert, owner seed (`scripts/seed-garage.ts`). Full steps: [docs/deploy.md](docs/deploy.md), plan: [docs/plans/phase-3-first-deploy.md](docs/plans/phase-3-first-deploy.md). These involve sign-ins and AWS spend, so an agent must not do them alone.
- Leak drill (`scripts/leak-drill.sh`, [docs/leak-drill.md](docs/leak-drill.md)) has not been run against GitHub yet; no result is recorded. Run it and record date, PR number and minutes to red in LESSONS.md or here.
- Check that the first weekly Dependabot npm run after the pnpm 12 switch (PR #38) parses and updates the two-document pnpm 12 lockfile (leading `---` env document). If it fails, open an issue; do not revert pnpm.
- Before the Phase 3 first deploy: run `deploy.yml` by workflow_dispatch or `sam build` locally under pnpm 12, and check that sharp's linux binaries still end up in the Lambda bundle now that only esbuild may run install scripts.
- `packages/shared` has no vitest config, so after `pnpm build` its test run also picks up compiled tests in `dist/__tests__` (119 becomes 238). Harmless but misleading; fix with a vitest config that excludes `dist`.

- Owner UI for pending borrow/reservation requests (list + approve/decline) is not built; the API endpoints exist.
- The api tests do not stub the Lambda client by default, so routes that call `invokeNotifier` go to the real SDK client (the failure is caught and logged). New tests use `__tests__/_notifier-spy.ts`; consider installing it for every test file.

## Next

1. Run the leak drill and record the result.
2. Operator: unblock Phase 3, then run `just verify-phase-3` and paste output here.
3. Phase 4 smoke test on an iPhone and an Android phone against production.
