import { useId } from "react";

export type SortKey = "recent" | "popular" | "az";

export type Filters = {
  query: string;
  category: string | null;
  availableOnly: boolean;
  sort: SortKey;
};

type Props = {
  filters: Filters;
  onChange: (next: Filters) => void;
  categories: string[];
};

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Recently added" },
  { value: "popular", label: "Most borrowed" },
  { value: "az", label: "A–Z" },
];

export function FilterBar({ filters, onChange, categories }: Props): JSX.Element {
  const searchId = useId();
  const sortId = useId();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={searchId} className="sr-only">
          Search tools
        </label>
        <input
          id={searchId}
          type="search"
          value={filters.query}
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
          placeholder="Search tools…"
          className="flex-1 min-w-[10rem] rounded-md border border-workshop/20 dark:border-surface-light/20 bg-surface-light/95 dark:bg-workshop/60 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold-bright"
        />
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filters.availableOnly}
            onChange={(e) => onChange({ ...filters, availableOnly: e.target.checked })}
            className="h-4 w-4 accent-gold-bright"
          />
          Available now
        </label>
        <label htmlFor={sortId} className="sr-only">
          Sort
        </label>
        <select
          id={sortId}
          value={filters.sort}
          onChange={(e) => onChange({ ...filters, sort: e.target.value as SortKey })}
          className="rounded-md border border-workshop/20 dark:border-surface-light/20 bg-surface-light/95 dark:bg-workshop/60 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold-bright"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {categories.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Categories">
          <CategoryChip
            label="All"
            active={filters.category === null}
            onClick={() => onChange({ ...filters, category: null })}
          />
          {categories.map((cat) => (
            <CategoryChip
              key={cat}
              label={cat}
              active={filters.category === cat}
              onClick={() => onChange({ ...filters, category: cat })}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "bg-gold-bright text-workshop border-gold-bright"
          : "border-workshop/20 dark:border-surface-light/20 hover:bg-workshop/5 dark:hover:bg-surface-light/5"
      }`}
    >
      {label}
    </button>
  );
}
