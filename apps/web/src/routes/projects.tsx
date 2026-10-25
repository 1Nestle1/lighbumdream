import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Link } from "react-router";
import {
  CheckCircleIcon,
  DesktopTowerIcon,
  FolderOpenIcon,
  HandPointingIcon,
  RocketLaunchIcon,
  StarIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import type { ProjectCard as Project } from "@lightbulb/shared";
import { useI18n } from "../i18n";
import { cn } from "../lib/format";
import { useFavorite, useProjects } from "../lib/queries";
import { EmptyState } from "../components/IdeaGrid";
import { PromptComposer } from "../components/PromptComposer";
import { useToast } from "../components/Toaster";

type Tone = "working" | "turn" | "done" | "failed" | "idle";

const WORKING = ["options_pending", "plan_pending", "building"];

/**
 * Your projects on one screen: starred favourites first, then the most recent. Each card shows
 * where the project is and has a prompt box to send its next instruction to a computer.
 */
export function ProjectsPage() {
  const { m } = useI18n();
  const projects = useProjects();
  const favorites = projects.data?.favorites ?? [];
  const recent = projects.data?.recent ?? [];

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tighter md:text-4xl">
          <RocketLaunchIcon size={30} weight="duotone" className="text-accent-ink" aria-hidden />
          {m.projects.title}
        </h1>
        <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-ink-soft">{m.projects.intro}</p>
      </header>

      {projects.isPending ? (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="shimmer h-[340px] rounded-card" />
          ))}
        </div>
      ) : favorites.length === 0 && recent.length === 0 ? (
        <EmptyState
          icon={<RocketLaunchIcon size={26} weight="duotone" />}
          title={m.projects.title}
          body={m.projects.empty}
        />
      ) : (
        <>
          <Section title={m.projects.favorites} count={favorites.length}>
            {favorites.length ? (
              <Grid projects={favorites} />
            ) : (
              <p className="rounded-card border border-dashed border-line-strong px-5 py-6 text-sm text-ink-soft">
                {m.projects.favoritesEmpty}
              </p>
            )}
          </Section>
          {recent.length > 0 && (
            <Section title={m.projects.recent} count={recent.length}>
              <Grid projects={recent} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-baseline gap-2 text-lg font-semibold tracking-tight">
        {title}
        <span className="font-mono text-xs font-normal text-ink-faint">{count}</span>
      </h2>
      {children}
    </section>
  );
}

function Grid({ projects }: { projects: Project[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {projects.map((project, i) => (
        <motion.div
          key={project.idea.id}
          layout="position"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30, delay: Math.min(i, 6) * 0.04 }}
          className="flex"
        >
          <ProjectCard project={project} />
        </motion.div>
      ))}
    </div>
  );
}

/** What the project is doing, in a word and a few lines. */
function useProjectState(project: Project): { tone: Tone; label: string; body: ReactNode } {
  const { m, fmt } = useI18n();
  const run = project.latestRun;
  const nextStep = project.idea.nextStep ? fmt(m.projects.nextStep, { step: project.idea.nextStep }) : null;

  if (!run) return { tone: "idle", label: m.projects.state.idle, body: nextStep ?? m.projects.noActivity };

  if (WORKING.includes(run.status)) {
    const lines = run.progress.slice(-4);
    return {
      tone: "working",
      label: m.projects.state.working,
      body: (
        <>
          {run.kind === "prompt" && run.prompt && <p className="line-clamp-2 text-ink">“{run.prompt}”</p>}
          {lines.length > 0 && (
            <ol className="mt-1.5 space-y-0.5 font-mono text-[11.5px] leading-relaxed text-ink-soft">
              {lines.map((line, i) => (
                <li key={`${i}:${line}`} className={cn("truncate", i === lines.length - 1 && "text-ink")}>
                  {line}
                </li>
              ))}
            </ol>
          )}
        </>
      ),
    };
  }
  if (run.status === "options_ready") return { tone: "turn", label: m.projects.state.yourTurn, body: m.projects.pickOption };
  if (run.status === "plan_ready") {
    return { tone: "turn", label: m.projects.state.yourTurn, body: run.plan ? `${m.projects.approvePlan} ${run.plan.title}` : m.projects.approvePlan };
  }
  if (run.status === "done") {
    return { tone: "done", label: m.projects.state.done, body: <p className="line-clamp-4">{run.result?.summary}</p> };
  }
  if (run.status === "failed") {
    return { tone: "failed", label: m.projects.state.failed, body: <p className="line-clamp-4">{run.error?.message}</p> };
  }
  return { tone: "idle", label: m.projects.state.cancelled, body: nextStep ?? m.projects.noActivity };
}

const TONE_STYLE: Record<Tone, string> = {
  working: "bg-accent text-on-accent",
  turn: "bg-accent-soft text-accent-ink ring-1 ring-accent-ink/30",
  done: "bg-sunken text-ink-soft",
  failed: "bg-danger/10 text-danger",
  idle: "bg-sunken text-ink-faint",
};

function ProjectCard({ project }: { project: Project }) {
  const { m, timeAgo, errorText } = useI18n();
  const toast = useToast();
  const favorite = useFavorite();
  const state = useProjectState(project);
  const run = project.latestRun;
  const starred = Boolean(project.favoriteAt);
  const busy = Boolean(run && WORKING.includes(run.status));

  const toggleStar = () =>
    favorite.mutate(
      { ideaId: project.idea.id, favorite: !starred },
      { onError: (err) => toast({ tone: "error", message: errorText(err) }) },
    );

  return (
    <article
      className={cn(
        "flex min-w-0 flex-1 flex-col rounded-card border bg-panel p-4 shadow-card transition-colors",
        state.tone === "turn" ? "border-accent-ink/40" : "border-line",
      )}
    >
      <header className="flex items-start gap-2">
        <button
          type="button"
          onClick={toggleStar}
          aria-pressed={starred}
          aria-label={starred ? m.projects.unstar : m.projects.star}
          title={starred ? m.projects.unstar : m.projects.star}
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition active:scale-90",
            starred ? "text-accent-ink" : "text-ink-faint hover:bg-sunken hover:text-ink-soft",
          )}
        >
          <StarIcon size={17} weight={starred ? "fill" : "regular"} aria-hidden />
        </button>
        <Link
          to={`/ideas/${project.idea.id}#agent`}
          className="min-w-0 flex-1 pt-0.5 text-[15px] font-semibold leading-snug tracking-tight text-ink hover:text-accent-ink"
          title={m.projects.open}
        >
          <span className="line-clamp-2">{project.idea.title}</span>
        </Link>
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold", TONE_STYLE[state.tone])}>
          {state.tone === "working" && (
            <span className="relative flex h-1.5 w-1.5" aria-hidden>
              <span className="absolute inset-0 animate-ping rounded-full bg-on-accent opacity-60 motion-reduce:animate-none" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-on-accent" />
            </span>
          )}
          {state.tone === "done" && <CheckCircleIcon size={12} weight="fill" aria-hidden />}
          {state.tone === "failed" && <WarningIcon size={12} weight="fill" aria-hidden />}
          {state.tone === "turn" && <HandPointingIcon size={12} weight="fill" aria-hidden />}
          {state.label}
        </span>
      </header>

      <p className="mt-1.5 flex items-center gap-2 pl-9 text-[12px] text-ink-faint">
        {project.lastRunner && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <DesktopTowerIcon size={12} aria-hidden />
            <span className="truncate">{project.lastRunner.name}</span>
            <span
              className={cn("h-1.5 w-1.5 shrink-0 rounded-full", project.lastRunner.online ? "bg-accent-ink" : "bg-line-strong")}
              aria-label={project.lastRunner.online ? m.agent.online : m.agent.offline}
            />
          </span>
        )}
        {project.idea.projectPath && (
          <span className="inline-flex min-w-0 items-center gap-1" title={project.idea.projectPath}>
            <FolderOpenIcon size={12} aria-hidden />
            <span className="truncate font-mono">{project.idea.projectPath.split(/[\\/]/).filter(Boolean).pop()}</span>
          </span>
        )}
        <span>{timeAgo(project.lastActivityAt)}</span>
      </p>

      <div className="mt-3 min-h-[92px] flex-1 border-t border-line/70 pt-3 text-[13px] leading-relaxed text-ink-soft">
        {state.body}
      </div>

      <PromptComposer
        ideaId={project.idea.id}
        busy={busy}
        preferredRunnerId={project.lastRunner?.id}
        compact
        className="mt-3"
      />
    </article>
  );
}
