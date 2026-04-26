// Single source of truth for the liability acknowledgement copy a borrower
// sees before a loan is created. The version string is stored on every Loan
// so we can render the historical copy a user actually agreed to.
export const LIABILITY_COPY_VERSION = "v1-2026-04";

export const LIABILITY_COPY = `
By borrowing this item I acknowledge:
1. I am borrowing this tool at my own risk.
2. The garage owner is not liable for damage, injury, or loss.
3. I will return the item in the same condition I received it.
4. If I lose or damage the item I will repair or replace it.
`.trim();

export interface LiabilityCopyDoc {
  version: string;
  text: string;
}

export function currentLiabilityCopy(): LiabilityCopyDoc {
  return { version: LIABILITY_COPY_VERSION, text: LIABILITY_COPY };
}
