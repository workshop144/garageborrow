function read(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${name}`);
}

function readOpt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export const env = {
  stage: () => read("STAGE", "dev"),
  region: () => read("AWS_REGION", "us-east-2"),
  tableName: () => read("TABLE_NAME"),
  imagesBucket: () => read("IMAGES_BUCKET"),
  userPoolId: () => readOpt("USER_POOL_ID"),
  cognitoClientId: () => readOpt("COGNITO_CLIENT_ID"),
  vapidPublicKey: () => readOpt("VAPID_PUBLIC_KEY") ?? "",
  notifierFunctionName: () =>
    readOpt("NOTIFIER_FUNCTION_NAME") ?? `garageborrow-notifier-${read("STAGE", "dev")}`,
  // Local-only escape hatch: trusts the x-test-phone header as the caller. Never
  // honoured on the prod stage, so a stray JWT_BYPASS=1 in a deployed function's
  // environment cannot turn into "anyone can sign in as anyone".
  jwtBypass: () => readOpt("JWT_BYPASS") === "1" && read("STAGE", "dev") !== "prod",
};
