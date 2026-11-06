import { writeFile } from "node:fs/promises";
import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: true,
  minify: !watch,
  // sharp is meant to ship via an arm64 sharp Lambda layer rather than bundled
  // (the platform-specific binary would balloon the zip and break cross-arch
  // deploys); no layer is attached in infra/template.yaml yet, see STATE.md.
  // sam build copies only each handler's own bundle (apps/api/Makefile), so every
  // external here must come from the Lambda runtime or a layer; the deploy
  // workflow refuses to deploy otherwise (scripts/check-lambda-externals.mjs
  // reads dist/externals.json, written below). web-push is bundled normally.
  external: ["@aws-sdk/*", "sharp"],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "info",
  metafile: true,
};

const targets = [
  { entryPoints: ["src/index.ts"], outfile: "dist/index.js" },
  { entryPoints: ["src/notifier.ts"], outfile: "dist/notifier.js" },
  { entryPoints: ["src/image-resizer.ts"], outfile: "dist/image-resizer.js" },
  { entryPoints: ["src/account-cleaner.ts"], outfile: "dist/account-cleaner.js" },
  {
    entryPoints: ["src/cognito-triggers/define-auth-challenge.ts"],
    outfile: "dist/define-auth-challenge.mjs",
  },
  {
    entryPoints: ["src/cognito-triggers/create-auth-challenge.ts"],
    outfile: "dist/create-auth-challenge.mjs",
  },
  {
    entryPoints: ["src/cognito-triggers/verify-auth-challenge.ts"],
    outfile: "dist/verify-auth-challenge.mjs",
  },
];

if (watch) {
  const ctxs = await Promise.all(targets.map((t) => context({ ...common, ...t })));
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log("esbuild watching...");
} else {
  const results = await Promise.all(targets.map((t) => build({ ...common, ...t })));
  // Bare module specifiers each bundle still imports at runtime, per bundle file.
  const externals = {};
  for (const { metafile } of results) {
    for (const [out, meta] of Object.entries(metafile.outputs)) {
      if (out.endsWith(".map")) continue;
      const mods = meta.imports.filter((i) => i.external).map((i) => i.path);
      externals[out.replace(/^dist\//, "")] = [...new Set(mods)].sort();
    }
  }
  await writeFile("dist/externals.json", `${JSON.stringify(externals, null, 2)}\n`);
}
