// Regression test for S4-3: `sam build` must never resolve or install
// dependencies (SAM's default Node builder runs `npm install` against
// apps/api/package.json with no lockfile, ignoring pnpm-lock.yaml,
// minimumReleaseAge and allowBuilds), and the deploy role's credentials must
// not exist in the job until the step right before `sam deploy`.
import { describe, expect, it } from "vitest";
import deployYml from "../../../../.github/workflows/deploy.yml?raw";
import template from "../../../../infra/template.yaml?raw";
import apiMakefile from "../../../api/Makefile?raw";

// Top-level resources of the template: logical id -> its indented body.
function resources(src: string): Map<string, string> {
  const body = src.split(/^Resources:\n/m)[1] ?? "";
  const out = new Map<string, string>();
  const parts = body.split(/^ {2}(?=[A-Za-z0-9]+:\n)/m);
  for (const part of parts) {
    const m = /^([A-Za-z0-9]+):\n/.exec(part);
    if (m) out.set(m[1], part);
  }
  return out;
}

const functions = [...resources(template)].filter(([, body]) =>
  /^ {4}Type: AWS::Serverless::Function$/m.test(body),
);

// deploy job steps, in order, as their raw text.
const steps = deployYml
  .split(/^ {4}steps:\n/m)[1]
  .split(/\n(?= {6}- )/)
  .filter((s) => /^ {6}- /.test(s));
const stepIndex = (re: RegExp) => {
  const hits = steps.map((s, i) => (re.test(s) ? i : -1)).filter((i) => i >= 0);
  expect(hits, `exactly one step matching ${re}`).toHaveLength(1);
  return hits[0];
};

// Makefile recipe lines (tab-indented), comments stripped.
const recipes = apiMakefile
  .split("\n")
  .filter((l) => l.startsWith("\t"))
  .map((l) => l.replace(/(^|\s)#.*$/, ""));

describe("deploy sam build hardening (S4-3)", () => {
  it("finds every Lambda in the template", () => {
    expect(functions.map(([id]) => id).sort()).toEqual(
      [
        "AccountCleanerFunction",
        "ApiFunction",
        "CreateAuthChallengeFunction",
        "DefineAuthChallengeFunction",
        "ImageResizerFunction",
        "NotifierFunction",
        "VerifyAuthChallengeFunction",
      ].sort(),
    );
  });

  it("no Globals Metadata or BuildMethod overrides the per-function setting", () => {
    const globals = template.split(/^Globals:\n/m)[1]?.split(/^\S/m)[0] ?? "";
    expect(globals).not.toMatch(/BuildMethod|Metadata/);
  });

  for (const [id, body] of functions) {
    it(`${id} builds with the makefile builder, never npm`, () => {
      expect(body).toMatch(/^ {4}Metadata:\n(?: {6}.*\n)*? {6}BuildMethod: makefile$/m);
      expect(body).toMatch(/^ {6}CodeUri: \.\.\/apps\/api\/$/m);
      expect(body).toMatch(/^ {6}Handler: dist\//m);
    });

    it(`apps/api/Makefile has a build-${id} target`, () => {
      const listed = /^FUNCTIONS := ((?:.*\\\n)*.*)$/m.exec(apiMakefile)?.[1] ?? "";
      expect(listed.split(/[\s\\]+/)).toContain(id);
    });
  }

  it("the Makefile only copies the esbuild bundles and installs nothing", () => {
    expect(recipes.length).toBeGreaterThan(0);
    for (const line of recipes) {
      // Quoted echo messages may name pnpm; commands may not.
      expect(line.replace(/"[^"]*"/g, '""')).not.toMatch(
        /\b(npm|npx|pnpm|yarn|corepack|node|curl|wget)\b/,
      );
    }
    expect(recipes.join("\n")).toMatch(
      /cp dist\/\*\.js dist\/\*\.mjs dist\/\*\.map "\$\(ARTIFACTS_DIR\)\/dist\/"/,
    );
    // The bundles are ESM; the artifact's package.json must stay dependency-free.
    expect(recipes.join("\n")).toMatch(/"type": "module"/);
    expect(recipes.join("\n")).not.toMatch(/dependencies/);
  });

  it("AWS credentials are configured after sam build, directly before sam deploy", () => {
    const install = stepIndex(/pnpm install/);
    const build = stepIndex(/run: pnpm build/);
    const setupSam = stepIndex(/uses: aws-actions\/setup-sam@/);
    const samBuild = stepIndex(/run: sam build/);
    const creds = stepIndex(/uses: aws-actions\/configure-aws-credentials@/);
    const samDeploy = stepIndex(/sam deploy/);
    expect(creds).toBeGreaterThan(install);
    expect(creds).toBeGreaterThan(build);
    expect(creds).toBeGreaterThan(setupSam);
    expect(creds).toBeGreaterThan(samBuild);
    expect(samDeploy).toBe(creds + 1);
    expect(samDeploy).toBe(steps.length - 1);
  });

  it("setup-sam is SHA-pinned and installs an exact SAM CLI version", () => {
    const step = steps[stepIndex(/uses: aws-actions\/setup-sam@/)];
    expect(step).toMatch(/uses: aws-actions\/setup-sam@[0-9a-f]{40}\b/);
    expect(step).toMatch(/^ {10}version: \d+\.\d+\.\d+$/m);
  });

  it("sam build is not given a flag that brings npm back", () => {
    const step = steps[stepIndex(/run: sam build/)];
    expect(step).not.toMatch(/--use-container|--build-image|--manifest|--use-makefile=false/);
  });
});
