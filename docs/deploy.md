# Deploying Your Own Garage

This is the post-launch playbook for spinning up a new `garage` tenant. The default region is `us-east-2` (Ohio); CloudFront cert validation must happen in `us-east-1` regardless of where the rest of the stack lives.

You should already have:

- An AWS account with the AWS CLI + SAM CLI configured
- A domain name (or willingness to register one — Step 1)
- Node 20 + pnpm 9 (`nvm use` against the repo's `.nvmrc`)

The whole flow takes about an hour the first time. Subsequent deploys go through GitHub Actions on `push` to `main`.

---

## 1. Buy a domain

Pick something meaningful (e.g. `yourgarage.com`). You can buy it directly in the Route 53 console (under **Registered domains → Register domain**) or through any registrar — if you go external, delegate the domain to Route 53 NS records once the hosted zone exists in Step 2.

## 2. Create a hosted zone

If you bought through Route 53, the hosted zone is created automatically. Otherwise:

```bash
aws route53 create-hosted-zone --name your-domain.com --caller-reference $(date +%s)
```

Update your registrar's NS records to the four returned by Route 53.

## 3. Request an ACM certificate in `us-east-1`

CloudFront only accepts certificates from `us-east-1` even though the rest of the stack is in `us-east-2`:

```bash
aws acm request-certificate \
  --region us-east-1 \
  --domain-name your-domain.com \
  --subject-alternative-names "*.your-domain.com" \
  --validation-method DNS
```

Note the returned `CertificateArn` — you'll wire it into `infra/template.yaml` in Step 5.

## 4. Add the CNAME validation records

If your hosted zone is in the same AWS account, the ACM console offers a **Create records in Route 53** button. Click it. Otherwise, manually copy the `_xxx.your-domain.com` CNAME records from the ACM console into Route 53. Validation finishes in ~5 minutes.

## 5. Wire the cert into `template.yaml` and re-deploy

In `infra/template.yaml`, locate the commented-out `Aliases` / `AcmCertificateArn` block under the CloudFront distribution. Uncomment and substitute:

```yaml
Aliases:
  - your-domain.com
ViewerCertificate:
  AcmCertificateArn: arn:aws:acm:us-east-1:ACCOUNT:certificate/UUID
  SslSupportMethod: sni-only
  MinimumProtocolVersion: TLSv1.2_2021
```

Then re-deploy:

```bash
make deploy
```

Add an A-record alias in Route 53 from `your-domain.com` to the CloudFront distribution.

## 6. Update Cognito callback URLs

The first-time deploy used a placeholder origin. Update the user-pool client:

```bash
aws cognito-idp update-user-pool-client \
  --user-pool-id us-east-2_XXX \
  --client-id XXX \
  --callback-urls "https://your-domain.com" \
  --logout-urls "https://your-domain.com"
```

## 7. Cognito SMS production access

Cognito starts in **SMS sandbox mode** — it can only send SMS to phone numbers you explicitly add as verified. To send to anyone, file a service-quota request:

1. Open the AWS console → **Service Quotas** → **Amazon SNS** → **Account spend limit increase**
2. Request a small initial limit (e.g. $5/month) and use case "OTP for app sign-in / verification"
3. Wait 1–3 business days for approval

While you wait, add the owner's phone (and any beta tester phones) as verified in the SNS sandbox so OTPs flow through.

## 8. Generate real VAPID keys

The first deploy left placeholder strings at `/garageborrow/<stage>/vapid_public_key` and `/vapid_private_key` in SSM (CloudFormation cannot create `SecureString` parameters directly). Replace them with a real keypair:

```bash
pnpm --filter @garageborrow/web exec tsx ../../scripts/gen-vapid.ts --stage prod
```

This deletes the placeholder and recreates each parameter as `SecureString` with fresh key material. The notifier Lambda picks them up on its next invocation.

## 9. AWS Budgets (manual)

The SAM template defines three CloudWatch billing alarms (`$5`, `$10`, `$25`). They are kept for spec fidelity but **will sit in `INSUFFICIENT_DATA` forever** in `us-east-2`: the `AWS/Billing` namespace only publishes `EstimatedCharges` to `us-east-1`. Don't remove them — they're harmless.

For real billing alerts, use **AWS Budgets** (works regardless of region):

1. Console → **Billing & Cost Management** → **Budgets** → **Create budget** → **Cost budget**
2. Create three thresholds at **$5 / $10 / $25** with email + SMS alerts to the owner contact
3. Filter the budget to the `garageborrow` resource tag if you tag your resources, or by service if not

## 10. Sentry (optional but recommended)

1. Sign up at sentry.io and create a new project of type **JavaScript / React** (web) — copy the DSN
2. Create a second project of type **Node.js / AWS Lambda** (api) — copy that DSN

Web DSN goes in Vercel as `VITE_SENTRY_DSN`, or as a build-time env var wherever you host the static bundle. API DSN goes into the SAM stack via the `SentryDsn` template parameter:

```bash
make deploy SAM_PARAMS="--parameter-overrides Stage=prod SentryDsn=https://...@sentry.io/..."
```

If left empty, the API Lambdas log a single boot warning per cold start and skip Sentry init — there's no failure path.

## 11. Seed the garage record

Insert the initial `Garage` record and `Membership` for the owner:

```bash
pnpm --filter @garageborrow/web exec tsx ../../scripts/seed-garage.ts \
  --name "Demo Garage" \
  --slug "demo-garage" \
  --owner-phone "+1XXXXXXXXXX" \
  --city-slug "sample-town" \
  --city-display "Sample Town, ST" \
  --stage prod
```

The script reads the DynamoDB table name from the CloudFormation stack outputs and is idempotent — if a garage with the slug already exists it prints a message and exits 0.

## 12. First inventory

Sign in as the owner phone (which now has a `Membership` with tier `owner`), then go to **/admin/items**. Photograph and add ~50 items. Each item gets one or more `Instance`s, tier requirements, and tags.

## 13. Subscribe the owner phone to alerts

Lambda DLQs / 5xx alarms publish to the `GarageBorrowAlerts-<stage>` SNS topic. Subscribe the owner's phone (or email) so failures actually reach a human:

```bash
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-2:ACCOUNT:GarageBorrowAlerts-prod \
  --protocol sms \
  --notification-endpoint "+1XXXXXXXXXX"
```

Confirm the subscription on the device.

---

## You're done

Smoke-test the deploy against `docs/smoke-test.md` from a real iPhone and a real Android device before you announce. The smoke test catches roughly 90% of the things that are too tedious to cover in CI.

When the smoke passes, tag the merge commit on `main`:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Then post `docs/launch-post.md` and tell people about your garage.

---

## Repo hardening (one-time, before first deploy)

Garage Borrow lives in a public repository. The following steps make
that safe by ensuring no static AWS credentials live in GitHub secrets
and no accidental secret commits land on `main`.

### Required

1. **Branch protection on `main`**
   Settings → Branches → Add branch ruleset for `main`:
   - Require pull request before merging (1 approval; for solo work,
     enable "Allow specified actors to bypass" with just yourself)
   - Require status checks to pass: `ci`, `Security Review`
   - Require branches to be up to date before merging
   - Restrict pushes that create matching branches: yes
   - Block force pushes: yes

2. **Secret scanning + push protection**
   Settings → Code security and analysis:
   - Secret scanning: Enable
   - Push protection: Enable (auto-blocks accidentally-committed secrets
     at the `git push` level)
   - Dependabot alerts: Enable
   - Dependabot security updates: Enable
   - CodeQL analysis: Enable (free for public repos)

3. **Required GitHub secrets**
   Settings → Secrets and variables → Actions → New repository secret:
   - `ANTHROPIC_API_KEY` — from console.anthropic.com → API keys.
     Used only by the `/security-review` workflow on PRs. Cap usage in
     the Anthropic console under Settings → Limits.
   - `SENTRY_DSN` (optional) — from sentry.io project settings, only if
     you want crash reporting wired.

4. **Verify `.gitignore` excludes**
   Confirm the following are in `.gitignore` (they should be already):
   `.env`, `.env.*`, `!.env.example`, `*.pem`, `aws-exports.json`,
   `.aws-sam/`, `.cdk.staging/`. Run:
   `git check-ignore -v .env aws-exports.json` — both should report
   they're ignored.

### Optional (only if you later want push-to-deploy from GitHub

Actions instead of running `make deploy` locally)

5. **AWS OIDC trust for GitHub Actions**
   a. In AWS IAM → Identity providers, add an OIDC provider with:
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`
     b. Create an IAM role `garageborrow-deploy` with this trust policy
     (replace ACCOUNT and confirm the repo path):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:broots144/garageborrow:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

c. Attach the same permissions to this role that your local
AWS profile uses for `sam deploy` (CloudFormation, IAM, Lambda,
DynamoDB, S3, CloudFront, Cognito, EventBridge, SSM, SNS, SES).
d. Update `.github/workflows/deploy.yml` to use the role via
`aws-actions/configure-aws-credentials@v4` with `role-to-assume`
pointing at the new role's ARN. Remove any AWS access key
references.
e. Test by triggering the deploy workflow manually
(`workflow_dispatch`) before relying on it for push-to-deploy.

Until step 5 is done, deploys happen via `make deploy-guided` (or
`make deploy` after first deploy) from your local terminal with
your AWS profile. That's the recommended approach for solo
development; CI-driven deploys add value when you have multiple
contributors or want zero-touch releases.

### Verification

After completing the required steps, open a no-op PR (e.g., a
whitespace fix in README.md) and confirm:

- `Security Review` workflow runs and posts a comment
- `ci` workflow runs and passes
- PR cannot merge until both are green
- Push protection blocks any commit containing a fake secret like
  `AKIA1234567890ABCDEF`
