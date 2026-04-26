import { motion } from "framer-motion";
import type { GarageItem } from "../../hooks/useGarageItems";
import { ToolCard } from "./ToolCard";

type Props = {
  items: GarageItem[];
};

const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.05 },
  },
};

export function PegboardGrid({ items }: Props): JSX.Element {
  return (
    <div className="relative rounded-lg overflow-hidden border border-workshop/15 dark:border-surface-light/10">
      <div className="absolute inset-0 bg-wood" aria-hidden="true" />
      <div className="absolute inset-0 bg-pegboard opacity-60" aria-hidden="true" />
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="relative grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-3 sm:p-4"
      >
        {items.map((item) => (
          <ToolCard key={item.id} item={item} />
        ))}
      </motion.div>
    </div>
  );
}
