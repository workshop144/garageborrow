// 2026-11-07 review F1: the HTTP API's default authorizer (Cognito JWT) runs
// before the Lambda, so a route the app serves without a token must be
// declared `Authorizer: NONE` in infra/template.yaml as well, and nothing else
// may be. Before this, POST /v1/auth/start was a 401 at the gateway and no
// invited number could ever sign in.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import { PUBLIC_ROUTES } from "../lib/public-routes.js";

const template = readFileSync(
  fileURLToPath(new URL("../../../../infra/template.yaml", import.meta.url)),
  "utf8",
);

function resource(name: string): string {
  const start = template.indexOf(`\n  ${name}:\n`);
  expect(start, name).toBeGreaterThan(-1);
  const rest = template.slice(start + 1);
  const next = rest.slice(3).search(/\n {2}[A-Za-z]/);
  return next === -1 ? rest : rest.slice(0, next + 3);
}

// HttpApi events of ApiFunction: "METHOD path" -> whether it opts out of auth.
function apiEvents(): Map<string, boolean> {
  const events = resource("ApiFunction").split(/^ {6}Events:\n/m)[1] ?? "";
  const out = new Map<string, boolean>();
  for (const block of events.split(/\n(?= {8}[A-Za-z0-9]+:\n)/)) {
    if (!/Type: HttpApi/.test(block)) continue;
    const method = /Method: (\S+)/.exec(block)?.[1] ?? "";
    const path = /Path: (\S+)/.exec(block)?.[1] ?? "";
    out.set(`${method} ${path}`, /Auth:\n\s+Authorizer: NONE/.test(block));
  }
  return out;
}

describe("public routes in infra/template.yaml", () => {
  it("keeps the Cognito JWT authorizer as the API default", () => {
    expect(resource("HttpApi")).toMatch(/DefaultAuthorizer: CognitoAuth/);
  });

  it("opts exactly the app's public routes out of the authorizer", () => {
    const open = [...apiEvents()].filter(([, none]) => none).map(([id]) => id);
    expect(open.sort()).toEqual([...PUBLIC_ROUTES].sort());
    // The catch-all routes stay behind the authorizer.
    expect(apiEvents().get("ANY /{proxy+}")).toBe(false);
    expect(apiEvents().get("ANY /")).toBe(false);
    // Nowhere else in the template.
    expect(template.match(/Authorizer: NONE/g)).toHaveLength(PUBLIC_ROUTES.length);
  });

  it("each public route exists in the app and answers without a token", async () => {
    const app = createApp();
    const registered = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
    for (const id of PUBLIC_ROUTES) {
      expect(registered.has(id), id).toBe(true);
      const [method, path] = id.split(" ") as [string, string];
      if (method !== "GET") continue;
      expect((await app.request(path)).status, id).toBe(200);
    }
  });

  it("serves the API on the $default stage, so paths reach Hono unprefixed", () => {
    expect(resource("HttpApi")).not.toMatch(/^ {6}StageName:/m);
    expect(template).toMatch(
      /ApiUrl:\n {4}Description: .*\n {4}Value: !Sub https:\/\/\$\{HttpApi\}\.execute-api\.\$\{AWS::Region\}\.amazonaws\.com\n/,
    );
  });
});
