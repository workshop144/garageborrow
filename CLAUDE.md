# Claude Code instructions for GarageBorrow

## Standard PR Workflow

Every feature branch must run `/security-review` locally before pushing
and opening a PR. The CI workflow (`.github/workflows/security-review.yml`)
re-runs `/security-review` on the PR as a safety net, but catching issues
locally is faster and cheaper than CI iteration.

### Required steps before opening any PR

1. Implement the change on the feature branch
2. Run `pnpm -r typecheck`, `pnpm -r test`, `pnpm -r build` until green
3. Run `make validate` if `infra/template.yaml` was modified
4. **Run `/security-review`** — fix all high-severity findings before push
5. Stage, commit, push
6. Open PR via `gh pr create`

### Trigger conditions for Claude Code sessions

When a prompt asks you to commit, push, and open a PR:

- BEFORE `git commit`, run `/security-review` on the staged changes
- If high-severity findings exist, present them and pause for the user's
  decision before proceeding to commit
- If only medium- or low-severity findings exist, document them in the PR
  body under a "Security review notes" section and continue
- Do NOT skip /security-review even if the user prompt doesn't explicitly
  mention it — it's a standing requirement for all PR-creating workflows

### Required URL field handling

Any new schema field that holds a URL must use the `HttpUrl` helper from
`packages/shared/src/schemas/common.ts`, not `z.string().url()` directly.
Zod 3.x's `.url()` accepts `javascript:`, `data:`, and `vbscript:` schemes
which is a stored XSS vector. Render user-supplied URLs through
`safeHref()` from `apps/web/src/lib/safeHref.ts`.
