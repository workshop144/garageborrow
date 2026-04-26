// Liability copy resolver. Given an item's tags, picks one of three tiers of
// confirmation copy from docs/borrow-confirmation-copy.md. The text is
// inlined here (rather than fetched at runtime) so the bundle is offline-
// safe and the copy version is stamped onto the loan record on the server.
//
// Keep this in sync with docs/borrow-confirmation-copy.md — the doc is the
// source of truth for editorial review.

export type LiabilityTier = "standard" | "power-tool" | "high-value";

const HIGH_VALUE_TAGS = ["trailer", "log-splitter", "log_splitter", "3d-printer", "cnc"];

const POWER_TOOL_TAGS = [
  "power-tool",
  "power_tool",
  "powertool",
  "sharp",
  "heavy",
  "motorized",
  "saw",
  "chainsaw",
  "grinder",
];

export function resolveLiabilityTier(tags: readonly string[]): LiabilityTier {
  const norm = tags.map((t) => t.toLowerCase());
  if (norm.some((t) => HIGH_VALUE_TAGS.includes(t))) return "high-value";
  if (norm.some((t) => POWER_TOOL_TAGS.includes(t))) return "power-tool";
  return "standard";
}

export const LIABILITY_COPY: Record<LiabilityTier, string> = {
  standard:
    "Heads up: tools are tools. Use it safely, and if anything goes sideways while you're using it — that's on you, not Dad. Cool? Tap below to take it home.",
  "power-tool":
    "This one's got teeth (or speed, or weight). You're saying you know how to use it safely, and if something goes wrong, that's on you. If you've never used one before, hit pause and ask first.\n\nBy tapping below, you're acknowledging Dad's not responsible for injury or damage from your use of this item.",
  "high-value":
    "This is one of the bigger items, and it requires Dad's approval before going anywhere.\n\nWhen you do borrow it: you're using it at your own risk, you're responsible for getting it home and back safely, and if it breaks under your watch you'll make it right.\n\nDad's not a contractor or rental company — just a guy with cool stuff. Use accordingly.",
};

export function liabilityCopyFor(tags: readonly string[]): string {
  return LIABILITY_COPY[resolveLiabilityTier(tags)];
}
