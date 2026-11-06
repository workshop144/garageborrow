// Regression test for S4-1: CI's Lighthouse step must run the lockfile-pinned
// lighthouse from apps/web, never a fresh `npx` download that skips
// pnpm-lock.yaml, minimumReleaseAge and allowBuilds. The check job also keeps a
// read-only token that is not persisted into .git/config.
import { describe, expect, it } from "vitest";
import lighthouseSh from "../../../../scripts/lighthouse.sh?raw";
import ciYml from "../../../../.github/workflows/ci.yml?raw";
import webPkg from "../../package.json";

// Shell lines with comments stripped, so prose that mentions npx is fine.
const code = (src: string) =>
  src
    .split("\n")
    .map((l) => l.replace(/(^|\s)#.*$/, ""))
    .join("\n");

describe("CI supply chain (S4-1)", () => {
  it("lighthouse.sh does not fetch packages with npx or dlx", () => {
    const sh = code(lighthouseSh);
    expect(sh).not.toMatch(/\bnpx\b/);
    expect(sh).not.toMatch(/\bdlx\b/);
    expect(sh).not.toMatch(/\bnpm\s+(exec|x)\b/);
    expect(sh).toMatch(/pnpm --filter @garageborrow\/web exec lighthouse /);
  });

  it("lighthouse is an exactly pinned devDependency of apps/web", () => {
    const devDeps = (webPkg as { devDependencies: Record<string, string> }).devDependencies;
    expect(devDeps.lighthouse).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("ci.yml defaults to a read-only token", () => {
    expect(ciYml).toMatch(/^permissions:\n {2}contents: read$/m);
  });

  it("every checkout in ci.yml sets persist-credentials: false", () => {
    const steps = ciYml.split(/\n(?=\s+- (?:uses|name):)/);
    const checkouts = steps.filter((s) => /uses: actions\/checkout@/.test(s));
    expect(checkouts.length).toBeGreaterThan(0);
    for (const step of checkouts) {
      expect(step).toMatch(/persist-credentials: false/);
    }
  });

  it("ci.yml does not run npx anywhere", () => {
    expect(code(ciYml)).not.toMatch(/\bnpx\b/);
  });
});
