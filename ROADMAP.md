# Roadmap

Status detail lives in [STATE.md](STATE.md). Decisions in [docs/DECISIONS.md](docs/DECISIONS.md).

| Phase | Title                                                                                | Status | Gate / blocker                                                           |
| ----- | ------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------ |
| 0     | v1.0 build: lending, tiers, donations, wishlist, notifications, admin                | ✅     | `just verify-phase-0`                                                    |
| 1     | Security hardening: audit runs 1 to 3                                                | ✅     | `just verify-phase-0` (tests cover the fixes)                            |
| 2     | Repo hygiene: Dependabot via n0, gitleaks, leak drill                                | ✅     | `just verify-phase-2`; drill not yet run on GitHub                       |
| 3     | First production deploy                                                              | 🔴     | Operator: domain, ACM, OIDC role, `DEPLOY_ENABLED`, Cognito SMS approval |
| 4     | Real-device smoke test and launch                                                    | ⬜     | Phase 3 live; [docs/smoke-test.md](docs/smoke-test.md)                   |
| 5     | Phase B: visit scheduling, AI assistant, native shells, self-serve tenant onboarding | ⏸      | No target date                                                           |
