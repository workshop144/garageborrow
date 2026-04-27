/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module "*.md?raw" {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_COGNITO_USER_POOL_ID?: string;
  readonly VITE_COGNITO_CLIENT_ID?: string;
  readonly VITE_TENANT_NAME?: string;
  readonly VITE_TENANT_SHORT_NAME?: string;
  readonly VITE_GARAGE_SLUG?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_RELEASE_SHA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
