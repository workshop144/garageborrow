import axe from "axe-core";
import { expect } from "vitest";

// Run axe against a rendered DOM node (typically the result of `render(...).container`)
// and assert there are zero violations. WCAG 2.0/2.1 Level AA tags are the
// default, matching the project's accessibility target.
export async function expectNoAxeViolations(node: Element): Promise<void> {
  const results = await axe.run(node, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  });
  if (results.violations.length === 0) return;
  const formatted = results.violations
    .map(
      (v) =>
        `[${v.id}] ${v.help} — ${v.nodes.length} node(s)\n  ${v.helpUrl}\n  ${v.nodes
          .map((n) => n.target.join(" "))
          .join("\n  ")}`,
    )
    .join("\n\n");
  expect.fail(`Axe found ${results.violations.length} accessibility violation(s):\n\n${formatted}`);
}
