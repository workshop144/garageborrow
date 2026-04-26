import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/index.js",
  sourcemap: true,
  minify: !watch,
  external: ["@aws-sdk/*"],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("esbuild watching...");
} else {
  await build(options);
}
