// Vitest setup: populates the env vars the API expects so route handlers
// don't blow up reading them. Each individual test file sets up its own
// DDB mock and auth verifier (see ./_setup.ts).
process.env["STAGE"] = "test";
process.env["AWS_REGION"] = "us-east-2";
process.env["TABLE_NAME"] = "GarageBorrow-test";
process.env["IMAGES_BUCKET"] = "garageborrow-images-test";
process.env["USER_POOL_ID"] = "us-east-2_TEST";
process.env["COGNITO_CLIENT_ID"] = "test-client";
process.env["VAPID_PUBLIC_KEY"] = "test-vapid-public";
process.env["LOG_LEVEL"] = "silent";
