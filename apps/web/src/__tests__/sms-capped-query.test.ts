// GB-R1-3 is an accepted risk (STATE.md): an outsider can spend a member's
// per-phone sign-in SMS budget. What makes it visible is a saved Logs Insights
// query over the create-auth trigger's log, which costs nothing until it runs.
// A metric filter or alarm would add a monthly charge, so neither is allowed
// for this without an operator decision.
import { describe, expect, it } from "vitest";
import template from "../../../../infra/template.yaml?raw";

function resource(name: string): string {
  const start = template.indexOf(`\n  ${name}:\n`);
  expect(start, `${name} resource`).toBeGreaterThan(-1);
  const rest = template.slice(start + 1);
  const next = rest.slice(3).search(/\n {2}[A-Za-z]/);
  return next === -1 ? rest : rest.slice(0, next + 3);
}

describe("sms-capped saved query", () => {
  it("queries the create-auth log group for both cap events", () => {
    const q = resource("SmsCappedQuery");
    expect(q).toContain("Type: AWS::Logs::QueryDefinition");
    expect(q).toMatch(/LogGroupNames:\n\s+- !Ref CreateAuthChallengeFunctionLogGroup/);
    expect(q).toContain('event = "sms_capped"');
    expect(q).toContain('event = "sms_phone_day_lockout"');
    expect(q).toContain("phone_last4");
  });

  it("adds no metric filter (a custom metric is a recurring cost)", () => {
    expect(template).not.toContain("AWS::Logs::MetricFilter");
  });
});
