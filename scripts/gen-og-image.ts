#!/usr/bin/env tsx
/**
 * Renders the social share image (1200x630) for og:image / twitter:image.
 *
 * Reads:  apps/web/public/og-image.svg
 * Writes: apps/web/public/og-image.png
 *
 * Usage:
 *   pnpm tsx scripts/gen-og-image.ts
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const publicDir = path.join(repoRoot, "apps", "web", "public");
const sourceSvg = path.join(publicDir, "og-image.svg");
const outPath = path.join(publicDir, "og-image.png");

async function main(): Promise<void> {
  const svg = await fs.readFile(sourceSvg);
  await sharp(svg, { density: 144 })
    .resize(1200, 630, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`wrote ${path.relative(repoRoot, outPath)}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
