import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: true,
  minify: !watch,
  // sharp is shipped via the public sharp Lambda layer rather than bundled
  // (the platform-specific binary would balloon the zip and break cross-arch
  // deploys). web-push is bundled normally — pure JS, ~50KB.
  external: ["@aws-sdk/*", "sharp"],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "info",
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
  await Promise.all(targets.map((t) => build({ ...common, ...t })));
}
