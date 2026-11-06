#!/usr/bin/env node
// Deploy gate (PR #46 review): every module a Lambda bundle still imports at
// runtime must exist in the Lambda. `sam build` ships only the handler's own
// esbuild bundle (apps/api/Makefile), no node_modules, so an external is only
// safe when the runtime provides it (Node builtins, `@aws-sdk/*` in nodejs24.x)
// or the function attaches a layer that provides it. Anything else (today:
// `sharp` in the image resizer, which has no layer yet) would deploy a function
// that fails at import, so the deploy workflow's build job runs this and stops.
//
// Usage: node scripts/check-lambda-externals.mjs [template] [externals.json]
// Reads apps/api/dist/externals.json, written by apps/api/esbuild.config.mjs.
// No dependencies: it runs in the deploy build job before any credentials exist.
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";

// Modules a layer can provide. Allowed only for a function whose template entry
// has a `Layers:` property; add the layer first, then the module here.
export const LAYER_MODULES = ["sharp"];

const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const providedByRuntime = (mod) => builtins.has(mod) || mod.startsWith("@aws-sdk/");

// AWS::Serverless::Function resources: logical id -> { bundleStem, hasLayers }.
export function lambdaFunctions(template) {
  const body = template.split(/^Resources:\n/m)[1] ?? "";
  const out = new Map();
  for (const part of body.split(/^ {2}(?=[A-Za-z0-9]+:\n)/m)) {
    const id = /^([A-Za-z0-9]+):\n/.exec(part)?.[1];
    if (!id || !/^ {4}Type: AWS::Serverless::Function$/m.test(part)) continue;
    const handler = /^ {6}Handler: dist\/([A-Za-z0-9-]+)\.[A-Za-z0-9_]+$/m.exec(part)?.[1];
    out.set(id, { bundleStem: handler ?? null, hasLayers: /^ {6}Layers:/m.test(part) });
  }
  return out;
}

// Problems as strings; an empty list means every function can load its bundle.
export function checkExternals(template, externals) {
  const problems = [];
  const fns = lambdaFunctions(template);
  if (fns.size === 0) problems.push("no AWS::Serverless::Function found in the template");
  for (const [id, { bundleStem, hasLayers }] of fns) {
    if (!bundleStem) {
      problems.push(`${id}: Handler is not dist/<bundle>.<export>`);
      continue;
    }
    const bundle = [`${bundleStem}.js`, `${bundleStem}.mjs`].find((b) => b in externals);
    if (!bundle) {
      problems.push(
        `${id}: dist/${bundleStem}.{js,mjs} missing from externals.json (run pnpm build)`,
      );
      continue;
    }
    for (const mod of externals[bundle]) {
      if (providedByRuntime(mod)) continue;
      if (hasLayers && LAYER_MODULES.includes(mod)) continue;
      problems.push(
        `${id}: dist/${bundle} imports "${mod}", which the Lambda runtime does not provide` +
          (LAYER_MODULES.includes(mod) ? " and the function attaches no layer" : ""),
      );
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [templatePath = "infra/template.yaml", externalsPath = "apps/api/dist/externals.json"] =
    process.argv.slice(2);
  const problems = checkExternals(
    readFileSync(templatePath, "utf8"),
    JSON.parse(readFileSync(externalsPath, "utf8")),
  );
  if (problems.length > 0) {
    for (const p of problems) console.error(`::error::${p}`);
    console.error("Refusing to deploy: a Lambda would fail at import (see STATE.md).");
    process.exit(1);
  }
  console.log("Every Lambda bundle imports only runtime or layer modules.");
}
