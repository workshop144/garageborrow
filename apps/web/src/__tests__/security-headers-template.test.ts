// 2026-11-07 review F6: CloudFront sends the security headers. A meta CSP
// cannot set frame-ancestors (browsers ignore it there), so the header is what
// stops the PWA from being framed; HSTS, nosniff, X-Frame-Options and the
// referrer policy have no meta equivalent at all.
import { describe, expect, it } from "vitest";
import indexHtml from "../../index.html?raw";
import template from "../../../../infra/template.yaml?raw";

function resource(name: string): string {
  const start = template.indexOf(`\n  ${name}:\n`);
  expect(start, `${name} resource`).toBeGreaterThan(-1);
  const rest = template.slice(start + 1);
  const next = rest.slice(3).search(/\n {2}[A-Za-z]/);
  return next === -1 ? rest : rest.slice(0, next + 3);
}

const policy = resource("SecurityHeadersPolicy");
const headerCsp = /ContentSecurityPolicy:\n\s+ContentSecurityPolicy: "([^"]+)"/.exec(policy)?.[1];
const metaCsp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(indexHtml)?.[1];

describe("CloudFront security headers (infra/template.yaml)", () => {
  it("is a free ResponseHeadersPolicy", () => {
    expect(policy).toMatch(/Type: AWS::CloudFront::ResponseHeadersPolicy/);
  });

  it("sends the same CSP as index.html, including frame-ancestors 'none'", () => {
    expect(metaCsp).toBeTruthy();
    expect(headerCsp).toBe(metaCsp);
    expect(headerCsp).toMatch(/frame-ancestors 'none'/);
    expect(headerCsp).toMatch(/default-src 'self'/);
    expect(headerCsp).not.toMatch(/'unsafe-eval'|script-src[^;]*'unsafe-inline'/);
  });

  it("lets the browser PUT photos to every stage's images bucket (Fable GB-F5-I1)", () => {
    const stages = /\n {2}Stage:\n(?: {4}.*\n)*? {4}AllowedValues:\n((?: {6}- .*\n)+)/
      .exec(template)?.[1]
      ?.match(/- (\S+)/g)
      ?.map((s) => s.slice(2));
    expect(stages?.length).toBeGreaterThan(0);
    expect(resource("ImagesBucket")).toMatch(/BucketName: !Sub garageborrow-images-\$\{Stage\}/);
    const connect = /connect-src ([^;]+);/.exec(headerCsp ?? "")?.[1]?.split(/\s+/) ?? [];
    for (const stage of stages ?? []) {
      expect(connect).toContain(`https://garageborrow-images-${stage}.s3.us-east-2.amazonaws.com`);
    }
    expect(connect).not.toContain("https://*.s3.us-east-2.amazonaws.com");
  });

  it("sets HSTS, nosniff, DENY framing and a referrer policy, overriding the origin", () => {
    expect(policy).toMatch(/StrictTransportSecurity:\n\s+AccessControlMaxAgeSec: (\d+)/);
    const maxAge = Number(/AccessControlMaxAgeSec: (\d+)/.exec(policy)?.[1]);
    expect(maxAge).toBeGreaterThanOrEqual(31536000);
    expect(policy).toMatch(/ContentTypeOptions:\n\s+Override: true/);
    expect(policy).toMatch(/FrameOptions:\n\s+FrameOption: DENY/);
    expect(policy).toMatch(/ReferrerPolicy: strict-origin-when-cross-origin/);
    expect(policy).toMatch(/Header: Permissions-Policy/);
    expect(policy.match(/Override: true/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("is attached to the default behaviour and to /img/*", () => {
    const dist = resource("Distribution");
    expect(dist.match(/ResponseHeadersPolicyId: !Ref SecurityHeadersPolicy/g)).toHaveLength(2);
    expect(dist).toMatch(
      /DefaultCacheBehavior:\n(?: {10}.*\n)*? {10}ResponseHeadersPolicyId: !Ref SecurityHeadersPolicy/,
    );
    expect(dist).toMatch(
      /- PathPattern: \/img\/\*\n(?: {12}.*\n)*? {12}ResponseHeadersPolicyId: !Ref SecurityHeadersPolicy/,
    );
  });
});
