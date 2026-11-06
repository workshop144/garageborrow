import type { JSX } from "react";
import { motion } from "framer-motion";
import { photoUrl } from "../../lib/photoUrl";

type Props = {
  itemId: string;
  photoKey: string;
  alt: string;
};

export function HeroImage({ itemId, photoKey, alt }: Props): JSX.Element {
  return (
    <motion.div
      layoutId={`tool-${itemId}`}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className="relative aspect-4/3 w-full overflow-hidden rounded-2xl bg-workshop/5 dark:bg-surface-light/5 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.25)]"
    >
      {photoKey ? (
        <img
          src={photoUrl(photoKey)}
          alt={alt}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center font-heading text-6xl text-gold-primary/60">
          {alt.charAt(0).toUpperCase() || "?"}
        </div>
      )}
    </motion.div>
  );
}
