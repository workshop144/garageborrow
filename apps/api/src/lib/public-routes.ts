// The only API routes that answer without a Cognito ID token. Each must also be
// an explicit `Auth: { Authorizer: NONE }` event on ApiFunction in
// infra/template.yaml, or API Gateway's default JWT authorizer returns 401
// before the Lambda runs (2026-11-07 review F1). Tests hold both lists to this.
export const PUBLIC_ROUTES = [
  "POST /v1/auth/start",
  "GET /v1/health",
  "GET /v1/openapi.json",
  "GET /v1/docs",
] as const;
