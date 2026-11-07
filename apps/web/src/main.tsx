import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource/permanent-marker/400.css";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";
import { loadRuntimeConfig } from "./lib/runtime-config";
import { initSentry } from "./lib/sentry";

initSentry();

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element not found");
}

// The API URL and Cognito ids come from /config.json, written at deploy time.
void loadRuntimeConfig().finally(() => {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
