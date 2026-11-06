// Regression test for S4-1: CI's Lighthouse step must run the lockfile-pinned
// lighthouse from the CI-only tools/lighthouse workspace package, never a fresh
// `npx` download that skips pnpm-lock.yaml, minimumReleaseAge and allowBuilds.
// Every workflow keeps its token out of .git/config, and the deploy job (OIDC
// role) does not install the CI-only tooling.
import { describe, expect, it } from "vitest";
import lighthouseSh from "../../../../scripts/lighthouse.sh?raw";
import lighthousePkgRaw from "../../../../tools/lighthouse/package.json?raw";
import webPkg from "../../package.json";

const workflows = import.meta.glob<string>("../../../../.github/workflows/*.yml", {
  query: "?raw",
  import: "default",
  eager: true,
});
const workflowFile = (name: string) => {
  const hit = Object.entries(workflows).find(([path]) => path.endsWith(`/${name}`));
  if (!hit) throw new Error(`workflow ${name} not found`);
  return hit[1];
};

// Lines with comments stripped, so prose that mentions npx is fine.
const code = (src: string) =>
  src
    .split("\n")
    .map((l) => l.replace(/(^|\s)#.*$/, ""))
    .join("\n");

describe("CI supply chain (S4-1)", () => {
  it("finds the workflow files", () => {
    const names = Object.keys(workflows).map((p) => p.split("/").pop());
    expect(names).toEqual(expect.arrayContaining(["ci.yml", "deploy.yml"]));
  });

  it("lighthouse.sh runs the pinned lighthouse with plain pnpm exec, never npx or dlx", () => {
    const sh = code(lighthouseSh);
    expect(sh).not.toMatch(/\bnpx\b/);
    expect(sh).not.toMatch(/\bdlx\b/);
    expect(sh).not.toMatch(/\bnpm\s+(exec|x)\b/);
    // `pnpm --filter ... exec` reports every failure as exit 1; plain
    // `pnpm exec` from the package dir passes lighthouse's own code through.
    expect(sh).toMatch(/cd "\$\{REPO_ROOT\}\/tools\/lighthouse" && pnpm exec lighthouse /);
  });

  it("lighthouse is exactly pinned in tools/lighthouse and not an app dependency", () => {
    const pkg = JSON.parse(lighthousePkgRaw) as {
      private?: boolean;
      devDependencies: Record<string, string>;
    };
    expect(pkg.private).toBe(true);
    expect(pkg.devDependencies.lighthouse).toMatch(/^\d+\.\d+\.\d+$/);
    const web = webPkg as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(web.dependencies?.lighthouse).toBeUndefined();
    expect(web.devDependencies?.lighthouse).toBeUndefined();
  });

  it("ci.yml defaults to a read-only token", () => {
    expect(workflowFile("ci.yml")).toMatch(/^permissions:\n {2}contents: read$/m);
  });

  it("deploy.yml installs without the CI-only tools/ packages", () => {
    const installs = code(workflowFile("deploy.yml"))
      .split("\n")
      .filter((l) => /\bpnpm install\b/.test(l));
    expect(installs.length).toBeGreaterThan(0);
    for (const line of installs) {
      expect(line).toContain("--filter '!./tools/*'");
    }
  });

  for (const [path, src] of Object.entries(workflows)) {
    const name = path.split("/").pop();

    it(`every checkout in ${name} sets persist-credentials: false`, () => {
      const steps = src.split(/\n(?=\s+- (?:uses|name):)/);
      for (const step of steps.filter((s) => /uses: actions\/checkout@/.test(s))) {
        expect(step).toMatch(/persist-credentials: false/);
      }
    });

    it(`${name} does not run npx or dlx`, () => {
      expect(code(src)).not.toMatch(/\bnpx\b/);
      expect(code(src)).not.toMatch(/\bdlx\b/);
    });
  }
});
