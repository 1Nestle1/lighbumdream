import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FootprintsIcon, LightningIcon, ShuffleIcon } from "@phosphor-icons/react";
import { useI18n } from "../i18n";
import { cn } from "../lib/format";
import { useFolders, usePickUp } from "../lib/queries";
import { FolderChip } from "./IdeaCard";
import { useOpenIdea } from "./IdeaGrid";
import { Button } from "./ui";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Resurfaces the filed idea that's been sitting longest, with its next step,
 * so ideas keep moving instead of quietly going stale.
 */
export function PickUpCard({ className }: { className?: string }) {
  const { m, plural } = useI18n();
  const pickUp = usePickUp();
  const folders = useFolders();
  const openIdea = useOpenIdea();
  const [index, setIndex] = useState(0);
  const ideas = pickUp.data?.ideas ?? [];

  if (pickUp.isPending) return <div className={cn("shimmer h-56 rounded-card", className)} aria-hidden />;
  if (ideas.length === 0) return null;

  const idea = ideas[index % ideas.length]!;
  const folder = folders.data?.folders.find((f) => f.id === idea.folderId);
  const days = Math.floor((Date.now() - new Date(idea.updatedAt).getTime()) / DAY);

  return (
    <section
      aria-labelledby="pickup-heading"
      className={cn("relative overflow-hidden rounded-card border border-line bg-panel p-5 shadow-card", className)}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-accent/25 blur-3xl"
      />
      <div className="relative flex items-center justify-between gap-3">
        <h2 id="pickup-heading" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <LightningIcon size={16} weight="fill" className="text-accent-ink" aria-hidden />
          {m.pickUp.title}
        </h2>
        <span className="font-mono text-[11px] text-ink-faint">
          {days < 1 ? m.pickUp.touchedToday : plural(m.pickUp.waiting, days)}
        </span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={idea.id}
          className="relative"
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="mt-4">
            <FolderChip folder={folder ? { name: folder.name, icon: folder.icon } : null} />
          </div>
          <p className="mt-2.5 text-lg font-semibold leading-snug tracking-tight">{idea.title}</p>
          <div className="mt-3 flex items-start gap-2.5 rounded-field bg-accent-soft/60 px-3.5 py-3">
            <FootprintsIcon size={17} weight="bold" className="mt-0.5 shrink-0 text-accent-ink" aria-hidden />
            <p className="text-sm leading-snug text-ink">
              <span className="sr-only">{m.pickUp.nextStep} </span>
              {idea.nextStep}
            </p>
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="relative mt-4 flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={() => openIdea(idea.id)}>
          {m.pickUp.startNow}
        </Button>
        {ideas.length > 1 && (
          <Button variant="ghost" size="sm" onClick={() => setIndex((i) => i + 1)}>
            <ShuffleIcon size={15} aria-hidden /> {m.pickUp.another}
          </Button>
        )}
      </div>
    </section>
  );
}
