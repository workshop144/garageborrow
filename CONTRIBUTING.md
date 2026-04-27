# Contributing to Garage Borrow

Thanks for your interest. Garage Borrow is intentionally small and approachable — a single-purpose neighborhood gear-lending PWA. Contributions are welcome whether you're adding a feature, fixing a bug, or standing up your own garage.

## Local setup

Prerequisites: Node 20 (use `nvm use` against `.nvmrc`), pnpm 9.

```bash
pnpm install
pnpm dev          # web app at http://localhost:5173
pnpm dev:api      # API in watch mode (esbuild)
```

Other scripts:

```bash
pnpm lint           # eslint
pnpm lint:fix       # auto-fix
pnpm format         # prettier --write
pnpm typecheck      # tsc --noEmit across the workspace
pnpm test           # vitest
pnpm build          # build every package + app
```

## Project layout

- `apps/web` — the PWA frontend (Vite + React + Tailwind)
- `apps/api` — the Lambda HTTP handler (Hono)
- `packages/shared` — Zod schemas, domain types, DynamoDB key codecs
- `packages/ui` — shared React components
- `infra/` — AWS SAM template
- `docs/` — project documentation
- `scripts/` — utility scripts

## Pull request workflow

1. Fork the repo and create a branch from `main`.
2. Make your changes. Keep commits focused; conventional-commit style is appreciated (`feat:`, `fix:`, `chore:`, `docs:`).
3. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` before pushing.
4. Open a PR against `main`. CI will run lint, typecheck, test, and build.
5. A maintainer will review. Small, focused PRs land fastest.

## Reporting issues

Please open a [GitHub issue](https://github.com/broots144/garageborrow/issues) for bugs and feature requests. For security-sensitive reports, email the maintainer directly rather than filing a public issue.

## Deploying your own garage

See the README's "Deploy" section. The first deploy is guided (`sam deploy --guided`); subsequent deploys go through GitHub Actions via OIDC.

## Code of Conduct

This project adopts the [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). See [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) for how to report incidents.

## Deploy your own garage

If you'd like to stand up your own neighborhood garage, see [`docs/deploy.md`](./docs/deploy.md) for the 13-step playbook (domain, ACM, Cognito SMS, VAPID, billing, error tracking, owner seed, first inventory).
