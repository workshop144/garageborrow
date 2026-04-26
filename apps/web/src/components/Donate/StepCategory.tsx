import { useId, useMemo, useState } from "react";

import { useGarageItems } from "../../hooks/useGarageItems";

type Props = {
  value: string;
  onChange: (next: string) => void;
};

// Combobox over existing item categories. Free text is allowed — typing a new
// category just submits whatever the user wrote. Suggestions reduce typos /
// proliferation but don't constrain the owner's eventual choice on accept.
export function StepCategory({ value, onChange }: Props): JSX.Element {
  const items = useGarageItems();
  const listId = useId();
  const [text, setText] = useState(value);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const it of items.data ?? []) set.add(it.category);
    return Array.from(set).sort();
  }, [items.data]);

  function commit(next: string): void {
    setText(next);
    onChange(next);
  }

  return (
    <div className="space-y-4" data-testid="donate-step-category">
      <header>
        <h2 className="font-heading text-2xl">Where would it go on the pegboard?</h2>
        <p className="mt-1 text-sm opacity-80">
          Optional. Pick an existing category or suggest a new one.
        </p>
      </header>
      <input
        type="text"
        list={listId}
        value={text}
        onChange={(e) => commit(e.target.value)}
        className="w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2 text-sm"
        placeholder="e.g. power-tools"
        data-testid="donate-category-input"
        autoComplete="off"
      />
      <datalist id={listId}>
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}
