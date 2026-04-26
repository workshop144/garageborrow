import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import type { GarageItem } from "../../hooks/useGarageItems";
import { StatusPill } from "./StatusPill";

type Props = {
  item: GarageItem;
};

const PHOTO_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/v1\/?$/, "") ?? "";

function rotationFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  // Map to [-2, 2] degrees.
  const norm = ((h % 1000) + 1000) % 1000;
  return (norm / 1000) * 4 - 2;
}

function photoUrl(key: string): string {
  if (!key) return "";
  if (key.startsWith("http")) return key;
  return `${PHOTO_BASE}/img/${key}`;
}

export function ToolCard({ item }: Props): JSX.Element {
  const rotate = rotationFor(item.id);
  const showQty =
    typeof item.available_count === "number" &&
    typeof item.total_count === "number" &&
    item.total_count > 1;

  return (
    <motion.div
      layoutId={`tool-${item.id}`}
      variants={{
        hidden: { opacity: 0, y: 12 },
        show: { opacity: 1, y: 0 },
      }}
      whileHover={{ scale: 1.02, y: -2, rotate: 0 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
      style={{ rotate: `${rotate}deg` }}
      className="relative"
    >
      <Link
        to={`/tool/${item.id}`}
        aria-label={`Borrow ${item.name}`}
        className="block rounded-lg bg-surface-light dark:bg-workshop border border-workshop/15 dark:border-surface-light/15 shadow-[0_2px_4px_rgba(0,0,0,0.12),0_8px_16px_-4px_rgba(0,0,0,0.18)] hover:shadow-[0_4px_8px_rgba(0,0,0,0.15),0_16px_28px_-6px_rgba(0,0,0,0.25)] transition-shadow overflow-hidden"
      >
        <div className="aspect-square relative bg-workshop/5 dark:bg-surface-light/5">
          {item.primary_photo_key ? (
            <img
              src={photoUrl(item.primary_photo_key)}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center font-heading text-3xl text-gold-primary/60">
              {item.name.charAt(0).toUpperCase()}
            </div>
          )}
          {showQty ? (
            <span className="absolute top-1.5 right-1.5 rounded-full bg-workshop/85 text-surface-light text-[10px] px-2 py-0.5 font-semibold">
              {item.available_count} of {item.total_count} ready
            </span>
          ) : null}
        </div>
        <div className="p-2.5">
          <div className="font-heading text-base leading-tight text-workshop dark:text-surface-light">
            {item.name}
          </div>
          <div className="mt-1.5">
            <StatusPill item={item} />
          </div>
          {item.donated_by_display ? (
            <div className="mt-1.5 inline-flex items-center rounded-sm bg-tier-howdy/40 dark:bg-tier-howdy/20 px-1.5 py-0.5 text-[10px] text-workshop/80 dark:text-surface-light/80">
              Donated by {item.donated_by_display}
            </div>
          ) : null}
        </div>
      </Link>
    </motion.div>
  );
}
