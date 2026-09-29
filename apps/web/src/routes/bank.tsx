import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Link } from "react-router";
import { ArrowRightIcon, CheckCircleIcon, StackIcon, TrayIcon } from "@phosphor-icons/react";
import type { BankCounts, Folder } from "@lightbulb/shared";
import { useI18n } from "../i18n";
import { useFolders, useIdeas } from "../lib/queries";
import { cn } from "../lib/format";
import { FolderGlyph } from "../components/FolderIcon";
import { EmptyState, IdeaGrid } from "../components/IdeaGrid";
import { OmnibarInline } from "../components/Omnibar";
import { PickUpCard } from "../components/PickUp";
import { SuggestionCard, SuggestionSkeleton } from "../components/SuggestionCard";

const INBOX_PREVIEW = 3;

/**
 * The bar is the centre of the page; everything around it keeps ideas moving:
 * what's waiting to be filed, an idea to pick back up, and what was filed lately.
 */
export function BankPage() {
  const { m, plural } = useI18n();
  const folders = useFolders();
  const inbox = useIdeas("inbox");
  const [pending, setPending] = useState(false);
  const [freshId, setFreshId] = useState<string | null>(null);

  const inboxIdeas = inbox.data?.pages.flatMap((p) => p.ideas) ?? [];
  const folderList = folders.data?.folders ?? [];
  const counts = folders.data?.counts;
  const hidden = (counts?.inbox ?? inboxIdeas.length) - Math.min(inboxIdeas.length, INBOX_PREVIEW);

  return (
    <div className="grid gap-x-8 gap-y-10 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-10">
        <header>
          <h1 className="text-3xl font-semibold tracking-tighter md:text-[2.5rem] md:leading-[1.05]">{m.bank.title}</h1>
          <p className="mt-2 max-w-[56ch] text-base leading-relaxed text-ink-soft">{m.bank.subtitle}</p>
        </header>

        <OmnibarInline onSaved={(idea) => setFreshId(idea.id)} onPendingChange={setPending} />

        <PickUpCard className="xl:hidden" />

        <section aria-labelledby="waiting-heading" className="min-w-0">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 id="waiting-heading" className="text-xl font-semibold tracking-tight">
              {m.bank.waiting}
            </h2>
            {hidden > 0 && (
              <Link to="/inbox" className="text-sm font-medium text-accent-ink hover:underline">
                {plural(m.bank.moreInInbox, hidden)}
              </Link>
            )}
          </div>
          <div className="flex flex-col gap-4">
            <AnimatePresence initial={false} mode="popLayout">
              {pending && (
                <motion.div key="pending" exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <SuggestionSkeleton />
                </motion.div>
              )}
              {inboxIdeas.slice(0, INBOX_PREVIEW).map((idea) => (
                <SuggestionCard key={idea.id} idea={idea} folders={folderList} highlight={idea.id === freshId} />
              ))}
            </AnimatePresence>
            {inbox.isPending && <SuggestionSkeleton />}
            {inbox.isSuccess && inboxIdeas.length === 0 && !pending && (
              <div className="flex items-center gap-4 rounded-card border border-dashed border-line-strong bg-panel/60 p-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
                  <CheckCircleIcon size={22} weight="duotone" aria-hidden />
                </span>
                <p className="text-sm leading-relaxed text-ink-soft">
                  <span className="font-medium text-ink">{m.bank.nothingWaiting}</span> {m.bank.nothingWaitingBody}
                </p>
              </div>
            )}
          </div>
        </section>

        <StatsColumn counts={counts} folders={folderList} loading={folders.isPending} className="xl:hidden" />

        <section aria-labelledby="recent-heading">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 id="recent-heading" className="text-xl font-semibold tracking-tight">
              {m.bank.recent}
            </h2>
            <Link to="/all" className="text-sm font-medium text-ink-soft hover:text-ink">
              {m.bank.allIdeas}
            </Link>
          </div>
          <IdeaGrid
            view="filed"
            columnsClass="columns-1 gap-4 sm:columns-2"
            empty={
              <EmptyState
                icon={<StackIcon size={26} weight="duotone" />}
                title={m.bank.emptyTitle}
                body={m.bank.emptyBody}
              />
            }
          />
        </section>
      </div>

      <div className="hidden xl:block">
        <div className="sticky top-10 flex flex-col gap-4">
          <PickUpCard />
          <StatsColumn counts={counts} folders={folderList} loading={folders.isPending} />
        </div>
      </div>
    </div>
  );
}

function StatsColumn({
  counts,
  folders,
  loading,
  className,
}: {
  counts?: BankCounts;
  folders: Folder[];
  loading: boolean;
  className?: string;
}) {
  const { m, plural } = useI18n();
  if (loading || !counts) {
    return (
      <aside className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-1", className)} aria-hidden>
        <div className="shimmer h-40 rounded-card" />
        <div className="shimmer h-32 rounded-card" />
      </aside>
    );
  }

  const topFolders = [...folders].sort((a, b) => b.ideaCount - a.ideaCount).slice(0, 6);

  return (
    <aside className={cn("grid content-start gap-4 sm:grid-cols-2 xl:grid-cols-1", className)} aria-label={m.bank.overview}>
      <Link
        to="/inbox"
        className={cn(
          "group relative overflow-hidden rounded-card p-5 transition-transform duration-300 hover:-translate-y-0.5",
          counts.inbox > 0 ? "bg-accent text-on-accent" : "border border-line bg-panel text-ink",
        )}
      >
        {counts.inbox > 0 && (
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-[oklch(1_0_0/0.35)] blur-2xl"
          />
        )}
        <div className="relative flex items-center justify-between">
          <TrayIcon size={22} weight={counts.inbox > 0 ? "fill" : "regular"} aria-hidden />
          <ArrowRightIcon size={18} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
        </div>
        <p className="relative mt-6 text-5xl font-semibold tabular-nums tracking-tighter">{counts.inbox}</p>
        <p className={cn("relative mt-1 text-sm font-medium", counts.inbox > 0 ? "opacity-80" : "text-ink-soft")}>
          {plural(m.bank.ideasWaiting, counts.inbox)}
        </p>
      </Link>

      <div className="rounded-card border border-line bg-panel p-5">
        <div className="flex items-baseline gap-2">
          <p className="text-4xl font-semibold tabular-nums tracking-tighter">{counts.all}</p>
          <p className="text-sm text-ink-soft">{plural(m.bank.inBank, counts.all)}</p>
        </div>
        <p className="mt-2 inline-flex rounded-full bg-sunken px-2.5 py-1 text-xs font-medium text-ink-soft">
          <span className="mr-1 font-semibold text-accent-ink">+{counts.thisWeek}</span> {m.bank.thisWeek}
        </p>

        {topFolders.length > 0 && (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-xs font-medium text-ink-faint">{m.bank.biggestFolders}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {topFolders.map((f) => (
                <Link
                  key={f.id}
                  to={`/folders/${f.id}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line py-1 pl-2 pr-2.5 text-xs font-medium text-ink-soft transition hover:border-line-strong hover:text-ink"
                >
                  <FolderGlyph name={f.icon} size={13} />
                  {f.name}
                  <span className="font-mono text-ink-faint">{f.ideaCount}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
