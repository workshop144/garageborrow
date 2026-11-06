# Decisions

Short ADR log. Never rewrite an entry; add a new one that supersedes it. Entries D-001 to D-010 were reconstructed on 2026-11-06 from git history; the date is when the decision landed.

- **D-001** (2026-04-25): Stack is React PWA + Hono on AWS Lambda + DynamoDB single table + Cognito + S3/CloudFront, deployed with SAM in us-east-2. Target under $5/month per tenant: HTTP API, on-demand DynamoDB, no VPC or NAT, arm64 Lambda. See README "Cost".
- **D-002** (2026-04-25): Multi-tenant from day 1. Each garage is a tenant; an optional `city_slug` facet on garages, no separate city entity.
- **D-003** (2026-04-25): Phone-only auth via Cognito custom-auth triggers. No passwords, no email, no money handling, no formal verification; trust is per-garage tiers (howdy, friend, family).
- **D-004** (2026-04-26): User-supplied URLs use `HttpUrl` in schemas and `safeHref()` at render; `z.url()` is not allowed for them (`ac67e56`).
- **D-005** (2026-04-26): Every PR runs `/security-review` locally before staging, with a CI copy as a safety net (`edbf889`, `1e7bf95`).
- **D-006** (2026-09-26): Per-deployment identity (tenant name, site URL, time zone, governing law, venue, garage slug) lives in GitHub repository variables and SAM parameters, never in code (`46e89fe`).
- **D-007** (2026-09-26): Production deploy is gated on repo variable `DEPLOY_ENABLED`; secret scanning uses the pinned gitleaks CLI (PR #2), later a reusable workflow (PR #36).
- **D-008** (2026-09-27): API identity is the verified phone claim of the Cognito ID token. Accounts are created by owner/admin invite only; self-service SignUp is closed (PRs #12, #14).
- **D-009** (2026-09-27): Data export is a direct download to the signed-in user, never emailed (PR #11).
- **D-010** (2026-10-31): Dependencies follow workshop144/sublevel ADR-089: weekly grouped Dependabot, n0 auto-merges green PRs (PRs #24, #25, #31).
- **D-011** (2026-11-06): Adopt the repo-state pattern: STATE.md is the one source of current truth, ROADMAP.md the phase table, LESSONS.md the incident log, this file the ADR log, `justfile` holds `check` and `verify-phase-N`, and CI `state-guard` fails code PRs that do not touch STATE.md unless the title starts with `chore` or `deps`.
