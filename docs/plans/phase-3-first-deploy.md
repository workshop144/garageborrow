# Phase 3 plan: first production deploy

Goal: the first garage tenant is live behind CloudFront, deployed by `deploy.yml` from `main`.

Every step below needs an AWS or registrar sign-in, spend, or SMS approval, so the operator runs it. An agent can prepare commands and review output. The authoritative step list is [docs/deploy.md](../deploy.md); this plan only orders it and says how we know it worked.

## Steps

1. Domain and Route 53 hosted zone (deploy.md steps 1 and 2).
2. ACM certificate in us-east-1, DNS-validated (step 3).
3. Cognito SMS: move SNS out of the SMS sandbox and register an origination identity; until then only verified numbers get OTPs.
4. VAPID keypair from `scripts/gen-vapid.ts`, stored as SAM parameters, not in the repo.
5. AWS Budgets alert at the $5/month target.
6. First deploy with `make build && make deploy-guided` from a laptop, so `infra/samconfig.toml` gains the prod config.
7. GitHub OIDC deploy role scoped to the `garageborrow-prod` stack, saved as secret `AWS_DEPLOY_ROLE_ARN`; create the `production` environment; set `DEPLOY_ENABLED=true`.
8. Owner seed with `scripts/seed-garage.ts`, then first inventory through `/admin/items`.

## Done when

- `just verify-phase-3` passes (the site URL from repo variable `SITE_URL` serves the PWA and `GET /v1/health` returns 200), and its output is pasted into STATE.md.
- The latest Deploy workflow run on `main` is `success`, not `skipped`.
