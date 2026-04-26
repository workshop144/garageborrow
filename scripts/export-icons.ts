#!/usr/bin/env tsx
/**
 * Generate the PNG icon set for apps/web from a single source SVG.
 *
 * Reads:  apps/web/public/icon-source.svg
 * Writes: apps/web/public/icon-{32,180-apple,192,512}.png
 *         apps/web/public/icon-maskable-{192,512}.png
 *
 * Usage:
 *   pnpm --filter @garageborrow/web icons
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const publicDir = path.join(repoRoot, "apps", "web", "public");
const sourceSvg = path.join(publicDir, "icon-source.svg");

const MASKABLE_BG = "#E8B833";
// Maskable safe area: scale icon to ~80% inside the canvas
const MASKABLE_INNER_RATIO = 0.8;

type Job =
  | { kind: "plain"; size: number; outName: string }
  | { kind: "maskable"; size: number; outName: string };

const jobs: Job[] = [
  { kind: "plain", size: 32, outName: "icon-32-favicon.png" },
  { kind: "plain", size: 180, outName: "icon-180-apple.png" },
  { kind: "plain", size: 192, outName: "icon-192.png" },
  { kind: "plain", size: 512, outName: "icon-512.png" },
  { kind: "maskable", size: 192, outName: "icon-maskable-192.png" },
  { kind: "maskable", size: 512, outName: "icon-maskable-512.png" },
];

async function renderPlain(svg: Buffer, size: number, out: string): Promise<void> {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(out);
}

async function renderMaskable(svg: Buffer, size: number, out: string): Promise<void> {
  const inner = Math.round(size * MASKABLE_INNER_RATIO);
  const innerPng = await sharp(svg, { density: 384 }).resize(inner, inner).png().toBuffer();
  const offset = Math.round((size - inner) / 2);
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: MASKABLE_BG,
    },
  })
    .composite([{ input: innerPng, top: offset, left: offset }])
    .png()
    .toFile(out);
}

async function main(): Promise<void> {
  const svg = await fs.readFile(sourceSvg);
  await fs.mkdir(publicDir, { recursive: true });
  for (const job of jobs) {
    const out = path.join(publicDir, job.outName);
    if (job.kind === "plain") {
      await renderPlain(svg, job.size, out);
    } else {
      await renderMaskable(svg, job.size, out);
    }
    console.log(`wrote ${path.relative(repoRoot, out)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
