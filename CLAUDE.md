# Claude Code instructions for GarageBorrow

## Session ritual

- Every session, before doing anything: read STATE.md, ROADMAP.md, LESSONS.md, then the task or phase prompt.
- State is in the repo, not in memory. Update STATE.md when you finish meaningful work. Commit before stopping.
- If stuck, write a clear BLOCKED entry in STATE.md with exact next steps.
- Update STATE.md in the same commit as the change it describes. CI `state-guard` fails a PR that changes `apps/`, `packages/`, `infra/`, `scripts/` or workflows without touching STATE.md, unless the PR title starts with `chore` or `deps`.
- New decisions go in `docs/DECISIONS.md` (append only). New incidents go at the top of LESSONS.md. Each phase writes `docs/plans/<phase>.md` before building.
- A phase is done only after its `just verify-phase-N` target passes and the output is pasted into STATE.md. `just check` is the local CI equivalent.
- Never write the deployment's real place, domain or people into repo files; they live in repository variables.

## Standard PR Workflow

Every feature branch must run `/security-review` locally before pushing
and opening a PR. The CI workflow (`.github/workflows/security-review.yml`)
re-runs a security review of the PR diff as a safety net, but catching issues
locally is faster and cheaper than CI iteration.

### Required steps before opening any PR

1. Implement the change on the feature branch
2. Run `pnpm lint`, `pnpm -r typecheck`, `pnpm -r test`, `pnpm -r build`
   until green
3. Run `make validate` if `infra/template.yaml` was modified
4. **Run `/security-review`** on the working-tree changes — fix all
   high-severity findings before staging
5. Stage and commit
6. Push
7. Open PR via `gh pr create`

### Trigger conditions for Claude Code sessions

When a prompt asks you to commit, push, and open a PR:

- BEFORE `git add`, run `/security-review` on the working-tree changes
- If high-severity findings exist, present them and pause for the user's
  decision before proceeding to stage and commit
- If only medium- or low-severity findings exist, document them in the PR
  body under a "Security review notes" section and continue
- Do NOT skip /security-review even if the user prompt doesn't explicitly
  mention it — it's a standing requirement for all PR-creating workflows
- When continuing work on an existing feature branch (rather than
  creating a new one from main), first run
  `git fetch origin && git rebase origin/main` and resolve any
  conflicts before adding new commits. Stale branches accumulate diff
  noise from main's merged changes.

### Required URL field handling

Any new schema field that holds a URL must use the `HttpUrl` helper from
`packages/shared/src/schemas/common.ts`, not `z.url()` directly.
Zod's URL validator accepts `javascript:`, `data:`, and `vbscript:` schemes
which is a stored XSS vector. Render user-supplied URLs through
`safeHref()` from `apps/web/src/lib/safeHref.ts`.
