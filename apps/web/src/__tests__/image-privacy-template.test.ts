// GB-R1-2: originals under uploads/ keep the uploader's EXIF (GPS position), so
// the CDN may serve only the resizer's metadata-free variants under img/.
// These checks read infra/template.yaml as text (CloudFormation tags such as
// !Sub are not plain YAML) and fail if a later edit widens access again.
import { describe, expect, it } from "vitest";
import template from "../../../../infra/template.yaml?raw";

// One top-level resource block: from "  Name:" to the next two-space key.
function resource(name: string): string {
  const start = template.indexOf(`\n  ${name}:\n`);
  expect(start, `${name} resource`).toBeGreaterThan(-1);
  const rest = template.slice(start + 1);
  const next = rest.slice(3).search(/\n {2}[A-Za-z]/);
  return next === -1 ? rest : rest.slice(0, next + 3);
}

describe("image privacy in infra/template.yaml", () => {
  it("lets CloudFront read only the img/ prefix of the images bucket", () => {
    const policy = resource("ImagesBucketPolicy");
    const resources = [...policy.matchAll(/Resource: (.+)/g)].map((m) => m[1]?.trim());
    expect(resources).toEqual(["!Sub ${ImagesBucket.Arn}/img/*"]);
  });

  it("serves /img/* from the images bucket (path maps to the img/ prefix)", () => {
    const dist = resource("Distribution");
    expect(dist).toMatch(/- PathPattern: \/img\/\*\n\s+TargetOriginId: imagesOrigin/);
    // No OriginPath or rewrite: /img/medium/<key> must be the object img/medium/<key>.
    expect(dist).not.toMatch(/OriginPath/);
  });

  it("triggers the resizer only for uploads/", () => {
    const bucket = resource("ImagesBucket");
    expect(bucket).toMatch(
      /Function: !GetAtt ImageResizerFunction\.Arn\n\s+Filter:\n\s+S3Key:\n\s+Rules:\n\s+- Name: prefix\n\s+Value: uploads\//,
    );
  });

  it("gives the resizer read on uploads/ and write on img/ only", () => {
    const fn = resource("ImageResizerFunction");
    expect(fn).toMatch(
      /Action: s3:GetObject\n\s+Resource: .+garageborrow-images-\$\{Stage\}\/uploads\/\*/,
    );
    expect(fn).toMatch(
      /Action: s3:PutObject\n\s+Resource: .+garageborrow-images-\$\{Stage\}\/img\/\*/,
    );
    expect(fn).not.toMatch(/garageborrow-images-\$\{Stage\}\/\*/);
  });

  it("gives the API only PutObject on uploads/", () => {
    const fn = resource("ApiFunction");
    const s3Lines = fn.split("\n").filter((l) => /s3:|ImagesBucket\.Arn/.test(l));
    expect(s3Lines.map((l) => l.trim())).toEqual([
      "Action: s3:PutObject",
      "Resource: !Sub ${ImagesBucket.Arn}/uploads/*",
    ]);
  });
});
