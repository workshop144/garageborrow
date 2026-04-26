import type { TierName } from "@garageborrow/shared";

import { usePromotionSuggestions, useUpdateMember } from "../../../hooks/useAdminMembers";

const NEXT_TIER: Record<TierName, TierName | null> = {
  howdy: "friend",
  friend: "family",
  family: null,
};

export function PromotionSuggestionsBanner(): JSX.Element | null {
  const suggestions = usePromotionSuggestions();
  const updateMember = useUpdateMember();

  if (suggestions.isLoading || suggestions.isError) return null;
  const items = suggestions.data?.suggestions ?? [];
  if (items.length === 0) return null;

  return (
    <section
      data-testid="promotion-suggestions"
      className="mb-4 rounded-2xl border border-gold-bright/40 bg-gold-bright/10 p-3"
    >
      <p className="font-semibold">Promotion suggestions</p>
      <ul className="mt-2 space-y-2">
        {items.map((s) => {
          const target = NEXT_TIER[s.current_tier] ?? s.suggested_tier;
          return (
            <li
              key={s.user_phone}
              className="flex flex-wrap items-center gap-2 text-sm"
              data-testid={`promotion-${s.user_phone}`}
            >
              <span className="flex-1">
                {s.user_phone.slice(-4)} has had {s.returns_on_time} on-time returns. Promote to{" "}
                {target}?
              </span>
              <button
                type="button"
                className="rounded-xl bg-gold-bright px-3 py-1 font-semibold text-workshop"
                onClick={() => updateMember.mutate({ phone: s.user_phone, body: { tier: target } })}
              >
                Yes
              </button>
              <button
                type="button"
                className="rounded-xl border border-workshop/15 dark:border-surface-light/15 px-3 py-1"
                onClick={() => undefined}
              >
                Not yet
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
