import type { ReactNode } from "react";
import { motion } from "motion/react";
import { useNavigate } from "react-router";
import { WarningIcon } from "@phosphor-icons/react";
import type { IdeaView } from "@lightbulb/shared";
import { useI18n } from "../i18n";
import { useFolders, useIdeas } from "../lib/queries";
import { IdeaCard, IdeaCardSkeleton } from "./IdeaCard";
import { Button } from "./ui";

/** Opens an idea's page. */
export function useOpenIdea() {
  const navigate = useNavigate();
  return (id: string) => navigate(`/ideas/${id}`);
}

const DEFAULT_COLUMNS = "columns-1 gap-4 sm:columns-2 xl:columns-3";

export function IdeaGrid({
  view,
  folderId,
  empty,
  columnsClass = DEFAULT_COLUMNS,
}: {
  view: IdeaView;
  folderId?: string;
  empty: ReactNode;
  columnsClass?: string;
}) {
  const { m, errorText } = useI18n();
  const query = useIdeas(view, folderId);
  const folders = useFolders();
  const openIdea = useOpenIdea();
  const byId = new Map((folders.data?.folders ?? []).map((f) => [f.id, f]));
  const ideas = query.data?.pages.flatMap((p) => p.ideas) ?? [];

  if (query.isPending) {
    return (
      <div className={columnsClass}>
        {[4, 2, 3, 3, 2, 4].map((lines, i) => (
          <IdeaCardSkeleton key={i} lines={lines} />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-card border border-danger/30 bg-panel p-6">
        <div className="flex items-center gap-2 font-medium text-danger">
          <WarningIcon size={18} weight="bold" aria-hidden /> {m.grid.loadError}
        </div>
        <p className="text-sm text-ink-soft">{errorText(query.error)}</p>
        <Button size="sm" onClick={() => query.refetch()}>
          {m.common.tryAgain}
        </Button>
      </div>
    );
  }

  if (ideas.length === 0) return <>{empty}</>;

  return (
    <div>
      <div className={columnsClass}>
        {ideas.map((idea, i) => {
          const folder = idea.folderId ? byId.get(idea.folderId) : undefined;
          return (
            <motion.div
              key={idea.id}
              className="mb-4 break-inside-avoid"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: Math.min(i, 8) * 0.035, ease: [0.16, 1, 0.3, 1] }}
            >
              <IdeaCard
                idea={idea}
                folder={folder ? { name: folder.name, icon: folder.icon } : null}
                onOpen={() => openIdea(idea.id)}
              />
            </motion.div>
          );
        })}
      </div>
      {query.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? m.common.loading : m.common.loadMore}
          </Button>
        </div>
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-card border border-dashed border-line-strong bg-panel/60 px-6 py-12 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
        {icon}
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-[42ch] text-sm leading-relaxed text-ink-soft">{body}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
