// Regression test for S4-3: `sam build` must never resolve or install
// dependencies (SAM's default Node builder runs `npm install` against
// apps/api/package.json with no lockfile, ignoring pnpm-lock.yaml,
// minimumReleaseAge and allowBuilds), and no job that installs or builds may be
// able to reach the deploy role. Moving the credentials step is not enough:
// with `id-token: write` every step in the job (install scripts, Vite and
// esbuild plugins) can request the OIDC token itself, so the role lives in a
// separate job that runs no repo or dependency code (PR #46 review). A deploy
// gate refuses bundles that import modules the Lambda will not have.
import { describe, expect, it } from "vitest";
import deployYml from "../../../../.github/workflows/deploy.yml?raw";
import template from "../../../../infra/template.yaml?raw";
import apiMakefile from "../../../api/Makefile?raw";
import esbuildConfig from "../../../api/esbuild.config.mjs?raw";
import { checkExternals, LAYER_MODULES } from "../../../../scripts/check-lambda-externals.mjs";

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

// Workflow text before `jobs:`, and each job's raw text by id.
const [workflowHead, jobsBody = ""] = deployYml.split(/^jobs:\n/m);
const jobs = new Map<string, string>();
for (const part of jobsBody.split(/^ {2}(?=[A-Za-z0-9_-]+:\n)/m)) {
  const id = /^([A-Za-z0-9_-]+):\n/.exec(part)?.[1];
  if (id) jobs.set(id, part);
}
const job = (id: string) => {
  const body = jobs.get(id);
  if (!body) throw new Error(`deploy.yml has no ${id} job`);
  return body;
};

// A job's steps, in order, as their raw text with comments stripped.
const stepsOf = (body: string) =>
  (body.split(/^ {4}steps:\n/m)[1] ?? "")
    .split(/\n(?= {6}- )/)
    .filter((s) => /^ {6}- /.test(s))
    .map((s) =>
      s
        .split("\n")
        .map((l) => l.replace(/(^|\s)#.*$/, ""))
        .join("\n"),
    );
const stepIndex = (steps: string[], re: RegExp) => {
  const hits = steps.map((s, i) => (re.test(s) ? i : -1)).filter((i) => i >= 0);
  expect(hits, `exactly one step matching ${re}`).toHaveLength(1);
  return hits[0];
};

const holdsIdToken = (body: string) => /^ {6}id-token: write$/m.test(body);
const buildSteps = stepsOf(job("build"));
const deploySteps = stepsOf(job("deploy"));

// What only a job without the deploy role may do: run repo or dependency code.
const RUNS_CODE =
  /\b(pnpm|npm|npx|yarn|corepack|node|make|sam build)\b|uses: (actions\/checkout|actions\/setup-node|pnpm\/action-setup)@/;

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

    it(`apps/api/Makefile has a build-${id} target that copies its handler's bundle`, () => {
      const listed = /^FUNCTIONS := ((?:.*\\\n)*.*)$/m.exec(apiMakefile)?.[1] ?? "";
      expect(listed.split(/[\s\\]+/)).toContain(id);
      const stem = /^ {6}Handler: dist\/([A-Za-z0-9-]+)\./m.exec(body)?.[1];
      const bundle = new RegExp(`^build-${id}: BUNDLE := (\\S+)$`, "m").exec(apiMakefile)?.[1];
      expect(bundle).toMatch(new RegExp(`^${stem}\\.m?js$`));
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
    // Only the function's own bundle and its source map, never a glob of all of them.
    expect(recipes.join("\n")).toMatch(
      /cp "dist\/\$\(BUNDLE\)" "dist\/\$\(BUNDLE\)\.map" "\$\(ARTIFACTS_DIR\)\/dist\/"/,
    );
    expect(recipes.join("\n")).not.toMatch(/\*/);
    // The bundles are ESM; the artifact's package.json must stay dependency-free.
    expect(recipes.join("\n")).toMatch(/"type": "module"/);
    expect(recipes.join("\n")).not.toMatch(/dependencies/);
  });

  it("top-level permissions are read-only, without id-token", () => {
    expect(workflowHead).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(workflowHead).not.toMatch(/id-token/);
  });

  it("only the deploy job can request the OIDC token, in the production environment", () => {
    expect([...jobs.keys()].sort()).toEqual(["build", "deploy"]);
    expect([...jobs].filter(([, body]) => holdsIdToken(body)).map(([id]) => id)).toEqual([
      "deploy",
    ]);
    expect(job("deploy")).toMatch(/^ {4}environment: production$/m);
    expect(job("deploy")).toMatch(/^ {4}needs: build$/m);
    // The build job has no environment (environment secrets) and an explicit read-only token.
    expect(job("build")).not.toMatch(/^ {4}environment:/m);
    expect(job("build")).toMatch(/^ {4}permissions:\n {6}contents: read\n(?! {6})/m);
    for (const id of jobs.keys()) {
      expect(job(id)).toMatch(/^ {4}if: vars\.DEPLOY_ENABLED == 'true'$/m);
    }
  });

  it("every install, build and sam build step is in a job without the deploy role", () => {
    for (const [id, body] of jobs) {
      if (!holdsIdToken(body)) continue;
      for (const step of stepsOf(body)) {
        expect(step, `${id} job step runs repo or dependency code`).not.toMatch(RUNS_CODE);
      }
    }
    stepIndex(buildSteps, /pnpm install/);
    stepIndex(buildSteps, /run: pnpm build/);
    stepIndex(buildSteps, /run: sam build/);
  });

  it("the deploy job only uses pinned deploy actions and runs only sam/aws commands", () => {
    const allowed =
      /uses: (aws-actions\/setup-sam|actions\/download-artifact|aws-actions\/configure-aws-credentials)@[0-9a-f]{40}\b/;
    for (const step of deploySteps) {
      if (/^ {6}- (name: .*\n {8})?uses:/m.test(step)) {
        expect(step).toMatch(allowed);
      } else {
        const run = step.split(/^ {8}run: \|?/m)[1] ?? "";
        expect(run.trim(), "run step").toMatch(/^(sam|aws) /);
        // No chaining or substitution (GitHub `${{ }}` expressions aside).
        expect(run.replace(/\$\{\{[^}]*\}\}/g, "")).not.toMatch(/[;&|`]|\$\(/);
      }
    }
  });

  it("the deploy job deploys exactly what the build job built", () => {
    const upload = buildSteps[stepIndex(buildSteps, /uses: actions\/upload-artifact@/)];
    const download = deploySteps[stepIndex(deploySteps, /uses: actions\/download-artifact@/)];
    expect(upload).toMatch(/^ {10}path: \.aws-sam\/build$/m);
    expect(upload).toMatch(/^ {10}include-hidden-files: true$/m);
    const name = /^ {10}name: (\S+)$/m.exec(upload)?.[1];
    expect(name).toBeTruthy();
    expect(download).toMatch(new RegExp(`^ {10}name: ${name}$`, "m"));
    expect(download).toMatch(/^ {10}path: \.aws-sam\/build$/m);
    expect(deploySteps[stepIndex(deploySteps, /sam deploy/)]).toMatch(
      /--template-file \.aws-sam\/build\/template\.yaml/,
    );
  });

  it("AWS credentials are configured directly before sam deploy, after the download", () => {
    const download = stepIndex(deploySteps, /uses: actions\/download-artifact@/);
    const setupSam = stepIndex(deploySteps, /uses: aws-actions\/setup-sam@/);
    const creds = stepIndex(deploySteps, /uses: aws-actions\/configure-aws-credentials@/);
    const samDeploy = stepIndex(deploySteps, /sam deploy/);
    expect(creds).toBeGreaterThan(download);
    expect(creds).toBeGreaterThan(setupSam);
    expect(samDeploy).toBe(creds + 1);
    // Later steps (S3 sync, CloudFront invalidation, smoke checks) are fine as
    // long as they are plain aws/sam commands; the previous test checks that.
  });

  it("the build job runs the Lambda import gate after pnpm build and before sam build", () => {
    const gate = stepIndex(buildSteps, /run: node scripts\/check-lambda-externals\.mjs$/m);
    expect(gate).toBeGreaterThan(stepIndex(buildSteps, /run: pnpm build/));
    expect(gate).toBeLessThan(stepIndex(buildSteps, /run: sam build/));
    expect(buildSteps[gate]).not.toMatch(/continue-on-error|\|\| true/);
    // esbuild writes the per-bundle list of runtime imports the gate reads.
    expect(esbuildConfig).toMatch(/metafile: true/);
    expect(esbuildConfig).toMatch(/dist\/externals\.json/);
  });

  it("setup-sam is SHA-pinned and installs an exact SAM CLI version in both jobs", () => {
    for (const steps of [buildSteps, deploySteps]) {
      const step = steps[stepIndex(steps, /uses: aws-actions\/setup-sam@/)];
      expect(step).toMatch(/uses: aws-actions\/setup-sam@[0-9a-f]{40}\b/);
      expect(step).toMatch(/^ {10}version: \d+\.\d+\.\d+$/m);
    }
  });

  it("sam build is not given a flag that brings npm back", () => {
    const step = buildSteps[stepIndex(buildSteps, /run: sam build/)];
    expect(step).not.toMatch(/--use-container|--build-image|--manifest|--use-makefile=false/);
  });
});

describe("Lambda import gate (scripts/check-lambda-externals.mjs)", () => {
  const fn = (id: string, handler: string, extra = "") =>
    `  ${id}:\n    Type: AWS::Serverless::Function\n    Properties:\n      Handler: dist/${handler}.handler\n${extra}`;
  const tpl = (...fns: string[]) => `Resources:\n${fns.join("")}`;

  it("allows Node builtins and @aws-sdk/* from the runtime", () => {
    expect(
      checkExternals(tpl(fn("A", "index")), {
        "index.js": ["node:crypto", "fs", "@aws-sdk/lib-dynamodb"],
      }),
    ).toEqual([]);
  });

  it("rejects any other bare import", () => {
    expect(checkExternals(tpl(fn("A", "index")), { "index.js": ["left-pad"] })).toHaveLength(1);
  });

  it("allows a layer module only when the function attaches a layer", () => {
    expect(LAYER_MODULES).toContain("sharp");
    const externals = { "image-resizer.js": ["sharp"] };
    expect(checkExternals(tpl(fn("R", "image-resizer")), externals)).toHaveLength(1);
    const withLayer = fn("R", "image-resizer", "      Layers:\n        - arn:aws:lambda:x\n");
    expect(checkExternals(tpl(withLayer), externals)).toEqual([]);
  });

  it("fails when a handler's bundle is missing from the build", () => {
    expect(checkExternals(tpl(fn("A", "index")), {})).toHaveLength(1);
  });

  it("blocks the real template today: the image resizer needs sharp and has no layer", () => {
    // When the sharp layer lands, attach it in infra/template.yaml and this
    // flips to an empty list; update this test in the same PR (STATE.md).
    const externals = Object.fromEntries(
      [...template.matchAll(/^ {6}Handler: dist\/([A-Za-z0-9-]+)\./gm)].map(([, stem]) => [
        `${stem}.js`,
        stem === "image-resizer" ? ["sharp", "@aws-sdk/client-s3"] : ["node:crypto"],
      ]),
    );
    expect(checkExternals(template, externals)).toEqual([
      expect.stringMatching(/^ImageResizerFunction: .*"sharp".*no layer/),
    ]);
  });
});
