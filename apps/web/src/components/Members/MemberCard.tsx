import { formatRelative } from "../../lib/dates";
import type { MemberDirectoryEntry } from "../../hooks/useMembers";

type Props = {
  member: MemberDirectoryEntry;
};

export function memberInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export function MemberCard({ member }: Props): JSX.Element {
  const initials = memberInitials(member.display_name);
  const activeNames = member.active_borrow_names ?? [];

  return (
    <article
      data-testid="member-card"
      className="rounded-2xl border border-workshop/10 dark:border-surface-light/10 bg-surface-light/60 dark:bg-workshop/40 p-4"
    >
      <div className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-gold-bright/30 font-heading text-base text-gold-bright"
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-heading text-base leading-snug">{member.display_name}</p>
          <p className="text-xs opacity-70">
            Member {formatRelative(member.joined_at)}
            {typeof member.borrows_total === "number"
              ? ` · ${member.borrows_total} borrow${member.borrows_total === 1 ? "" : "s"}`
              : ""}
          </p>
        </div>
      </div>
      {activeNames.length > 0 ? (
        <p className="mt-2 text-xs opacity-80">
          Has {activeNames.slice(0, 2).join(", ")}
          {activeNames.length > 2 ? `, +${activeNames.length - 2}` : ""}
        </p>
      ) : null}
    </article>
  );
}
