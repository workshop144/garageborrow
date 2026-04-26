# Garage Borrow

> Lend what you have. Borrow what you need. An open-source neighborhood gear-sharing platform.

Garage Borrow is a multi-tenant PWA for neighborhood tool libraries. Each "garage" is a tenant; the first deployed instance serves one small town. Phone-only auth, no money handling, runs on a shoestring AWS bill.

## Why

Neighbors already share tools — informally, in texts and group chats. Garage Borrow gives that the lightest possible app: a pegboard you can browse, borrow from, and return to without an account email or a credit card. It's open source so any neighborhood can stand up its own instance.

## Quick start

Prerequisites: Node 20 (`.nvmrc`), pnpm 9, AWS CLI + SAM CLI configured for `us-east-2`.

```bash
pnpm install
pnpm dev          # starts the web app on http://localhost:5173
pnpm dev:api      # starts the API in watch mode
pnpm build        # builds every package + app
pnpm lint         # eslint
pnpm typecheck    # tsc --noEmit across the workspace
pnpm test         # vitest
```

## Architecture

```
apps/
  web/          Vite + React 18 + TypeScript + Tailwind + Framer Motion + vite-plugin-pwa
  api/          Hono on AWS Lambda, esbuild-bundled, behind API Gateway HTTP API
packages/
  shared/       Zod schemas, domain types, DynamoDB key encoders/decoders
  ui/           Shared React components (extracted later for native reuse)
infra/          AWS SAM template
scripts/        Utility scripts (icon export, OpenAPI gen, etc.)
docs/           Project documentation
.github/
  workflows/
    ci.yml      lint, typecheck, test, build on PR + main
    deploy.yml  SAM deploy on push to main (AWS via OIDC)
```

Backend stack: API Gateway HTTP API → Lambda (Node 20, Hono) → DynamoDB (single table, on-demand). Cognito User Pool with phone-only signup. S3 + CloudFront (price class 100) for static + images. SNS for SMS, web-push for in-app.

## Cost

Target: under $5/month at small scale (one neighborhood, dozens of items, hundreds of borrows/month). Achieved by:

- HTTP API instead of REST API
- DynamoDB on-demand
- CloudFront price class 100 (US/Canada/Europe)
- No NAT gateway, no VPC, no Aurora, no ElastiCache

## Deploy

First-time deploy uses guided SAM:

```bash
sam build --template infra/template.yaml
sam deploy --guided --region us-east-2
```

Subsequent deploys go through GitHub Actions on push to `main` (see `.github/workflows/deploy.yml`). The workflow assumes an AWS IAM role via OIDC — configure `AWS_DEPLOY_ROLE_ARN` as a repo secret.

## License

[MIT](./LICENSE) — Copyright 2026 Mr. Broots.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
