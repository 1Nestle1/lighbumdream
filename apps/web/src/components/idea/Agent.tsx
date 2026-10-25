import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Link } from "react-router";
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  CloudIcon,
  DesktopTowerIcon,
  FileIcon,
  FolderOpenIcon,
  GithubLogoIcon,
  PaperPlaneRightIcon,
  PlusIcon,
  RobotIcon,
  SealCheckIcon,
  SparkleIcon,
  StopIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import type { AgentKind, AgentOption, AgentsResponse, IdeaRun, Runner } from "@lightbulb/shared";
import { AGENT_LABELS, AGENT_LIMITS } from "@lightbulb/shared/constants";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/format";
import {
  useAgents,
  useIntegrations,
  useRunActions,
  useRuns,
  useUpdateIdea,
  type useNotebookActions,
} from "../../lib/queries";
import { ComputersDialog, CopyCommand } from "../Computers";
import { PromptComposer } from "../PromptComposer";
import { useToast } from "../Toaster";
import { Button } from "../ui";

type NotebookActions = ReturnType<typeof useNotebookActions>;
type RunActions = ReturnType<typeof useRunActions>;
type Target = { kind: "cloud" } | { kind: "local"; runnerId: string; agent: AgentKind };

const ACTIVE = ["options_pending", "options_ready", "plan_pending", "plan_ready", "building"];
const TARGET_KEY = "lb-agent-target";
const spring = { type: "spring", stiffness: 320, damping: 30 } as const;

const agentName = (run: IdeaRun, cloud: string) => (run.agent === "cloud" ? cloud : AGENT_LABELS[run.agent]);

function readTarget(): Target | null {
  try {
    return JSON.parse(localStorage.getItem(TARGET_KEY) ?? "null") as Target | null;
  } catch {
    return null;
  }
}
function storeTarget(target: Target) {
  try {
    localStorage.setItem(TARGET_KEY, JSON.stringify(target));
  } catch {
    // Only a convenience.
  }
}

/** The last choice if it's still possible, else an online computer, else the cloud. */
function defaultTarget(data: AgentsResponse | undefined): Target | null {
  if (!data) return null;
  const usable = data.runners.filter((r) => r.agents.length > 0);
  const saved = readTarget();
  if (saved?.kind === "cloud" && data.cloud.available) return saved;
  if (saved?.kind === "local") {
    const runner = usable.find((r) => r.id === saved.runnerId);
    if (runner) return { ...saved, agent: runner.agents.includes(saved.agent) ? saved.agent : runner.agents[0]! };
  }
  const runner = usable.find((r) => r.online) ?? usable[0];
  if (runner) return { kind: "local", runnerId: runner.id, agent: runner.agents[0]! };
  return data.cloud.available ? { kind: "cloud" } : null;
}

/**
 * Hands the idea to an agent: options, pick one, a plan to approve, then the build.
 * Lives on the idea page under the next step.
 */
export function AgentSection({
  ideaId,
  projectPath,
  notebook,
}: {
  ideaId: string;
  projectPath: string | null;
  notebook: NotebookActions;
}) {
  const { m, fmt, errorText } = useI18n();
  const toast = useToast();
  const runs = useRuns(ideaId);
  const agents = useAgents();
  const actions = useRunActions(ideaId);
  const [composing, setComposing] = useState(false);

  const latest = runs.data?.runs[0];
  const active = latest && ACTIVE.includes(latest.status);
  const showStart = !latest || composing || latest.status === "cancelled";

  const cancel = () =>
    latest &&
    actions.cancel.mutate(latest.id, {
      onSuccess: () => toast({ tone: "success", message: m.agent.cancelled }),
      onError: (err) => toast({ tone: "error", message: errorText(err) }),
    });

  return (
    <section
      id="agent"
      aria-labelledby="agent-heading"
      className="@container relative scroll-mt-24 overflow-hidden rounded-card border border-line bg-panel p-5 shadow-card md:p-7"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="agent-heading" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <RobotIcon size={18} weight="bold" className="text-accent-ink" aria-hidden />
          {m.agent.title}
        </h2>
        {latest && active && !composing && (
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-ink-soft">
              {fmt(m.agent.runsOn, {
                agent: agentName(latest, m.agent.cloud),
                place: latest.target === "cloud" ? m.agent.theCloud : (latest.runner?.name ?? "?"),
              })}
            </span>
            <Button size="sm" variant="ghost" onClick={cancel} disabled={actions.cancel.isPending}>
              <StopIcon size={14} weight="fill" aria-hidden /> {m.agent.cancelRun}
            </Button>
          </div>
        )}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={runs.isPending ? "loading" : showStart ? "start" : `${latest!.id}:${latest!.status}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={spring}
          className="mt-4"
        >
          {runs.isPending ? (
            <div className="space-y-3" aria-hidden>
              <div className="shimmer h-5 w-2/3 rounded-full" />
              <div className="shimmer h-24 rounded-field" />
            </div>
          ) : showStart ? (
            <StartPanel
              data={agents.data}
              actions={actions}
              note={latest?.status === "cancelled" && !composing ? m.agent.cancelledTitle : null}
              onStarted={() => setComposing(false)}
              onBack={latest && composing ? () => setComposing(false) : undefined}
            />
          ) : (
            <RunView run={latest!} actions={actions} notebook={notebook} onNewRun={() => setComposing(true)} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Your own instruction, any time: it runs at once on the computer you pick. */}
      <div className="mt-6 border-t border-line pt-5">
        <ProjectFolderField ideaId={ideaId} projectPath={projectPath} />
        <h3 className="mb-2.5 mt-5 text-[13px] font-semibold text-ink">{m.prompt.title}</h3>
        <PromptComposer
          ideaId={ideaId}
          busy={Boolean(active)}
          preferredRunnerId={runs.data?.runs.find((r) => r.runner)?.runner?.id}
        />
      </div>

      {latest && !showStart && latest.events.length > 0 && <History run={latest} />}
    </section>
  );
}

// ---------- Choosing where it runs ----------

function TargetTile({
  selected,
  disabled,
  onSelect,
  icon,
  title,
  status,
  body,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  status?: ReactNode;
  body: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex items-start gap-3 rounded-field border p-3.5 text-left transition active:scale-[0.99]",
        selected
          ? "border-accent-ink/60 bg-accent-soft/60 ring-4 ring-accent/20"
          : "border-line bg-panel hover:border-line-strong hover:bg-sunken/60",
        disabled && "cursor-not-allowed opacity-55",
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          selected ? "bg-accent text-on-accent" : "bg-sunken text-ink-soft",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">{title}</span>
          {status}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-soft">{body}</span>
      </span>
    </button>
  );
}

function OnlineBadge({ runner }: { runner: Runner }) {
  const { m } = useI18n();
  return (
    <span className={cn("flex items-center gap-1 text-[11px] font-medium", runner.online ? "text-accent-ink" : "text-ink-faint")}>
      <span className={cn("h-1.5 w-1.5 rounded-full", runner.online ? "bg-accent-ink" : "bg-line-strong")} aria-hidden />
      {runner.online ? m.agent.online : m.agent.offline}
    </span>
  );
}

function StartPanel({
  data,
  actions,
  note,
  onStarted,
  onBack,
}: {
  data: AgentsResponse | undefined;
  actions: RunActions;
  note: string | null;
  onStarted: () => void;
  onBack?: () => void;
}) {
  const { m, fmt, errorText } = useI18n();
  const toast = useToast();
  const [target, setTarget] = useState<Target | null>(null);
  const [computersOpen, setComputersOpen] = useState(false);
  const fallback = useMemo(() => defaultTarget(data), [data]);
  const chosen = target ?? fallback;
  const runners = data?.runners ?? [];
  const selectedRunner = chosen?.kind === "local" ? runners.find((r) => r.id === chosen.runnerId) : undefined;

  const start = () => {
    if (!chosen) return;
    storeTarget(chosen);
    const body =
      chosen.kind === "cloud"
        ? ({ target: "cloud" } as const)
        : ({ target: "local", runnerId: chosen.runnerId, agent: chosen.agent } as const);
    actions.start.mutate(body, {
      onSuccess: onStarted,
      onError: (err) => toast({ tone: "error", message: errorText(err) }),
    });
  };

  return (
    <div>
      {note && <p className="mb-3 text-[13px] font-medium text-ink-soft">{note}</p>}
      <p className="max-w-[60ch] text-[15px] leading-relaxed text-ink-soft">{m.agent.intro}</p>

      <p className="mt-5 text-[13px] font-medium text-ink-soft" id="agent-where">
        {m.agent.whereLabel}
      </p>
      {!data ? (
        <div className="mt-2 grid gap-3 @md:grid-cols-2" aria-hidden>
          <div className="shimmer h-[72px] rounded-field" />
          <div className="shimmer h-[72px] rounded-field" />
        </div>
      ) : (
        <div role="radiogroup" aria-labelledby="agent-where" className="mt-2 grid gap-3 @md:grid-cols-2">
          {runners.map((runner) => (
            <TargetTile
              key={runner.id}
              selected={chosen?.kind === "local" && chosen.runnerId === runner.id}
              disabled={runner.agents.length === 0}
              onSelect={() => setTarget({ kind: "local", runnerId: runner.id, agent: runner.agents[0]! })}
              icon={<DesktopTowerIcon size={18} weight="bold" aria-hidden />}
              title={runner.name}
              status={<OnlineBadge runner={runner} />}
              body={runner.agents.length ? runner.agents.map((a) => AGENT_LABELS[a]).join(", ") : m.agent.noAgents}
            />
          ))}
          {data.cloud.available ? (
            <TargetTile
              selected={chosen?.kind === "cloud"}
              onSelect={() => setTarget({ kind: "cloud" })}
              icon={<CloudIcon size={18} weight="bold" aria-hidden />}
              title={m.agent.cloud}
              body={
                data.cloud.ownKey
                  ? fmt(m.agent.cloudOwnKey, { budget: data.cloud.budgetUsd })
                  : fmt(m.agent.cloudHint, { budget: data.cloud.budgetUsd, builds: data.cloud.buildsPerDay })
              }
            />
          ) : (
            <Link
              to="/integrations"
              className="flex items-start gap-3 rounded-field border border-dashed border-line-strong p-3.5 text-left transition hover:border-accent-ink/60 hover:bg-sunken/60 active:scale-[0.99]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink-soft">
                <CloudIcon size={18} weight="bold" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{m.agent.cloud}</span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-soft">{m.agent.cloudOff}</span>
              </span>
            </Link>
          )}
          <button
            type="button"
            onClick={() => setComputersOpen(true)}
            className="flex items-start gap-3 rounded-field border border-dashed border-line-strong p-3.5 text-left transition hover:border-accent-ink/60 hover:bg-sunken/60 active:scale-[0.99]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink-soft">
              <PlusIcon size={18} weight="bold" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">
                {runners.length ? m.agent.manageComputers : m.agent.connectComputer}
              </span>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-soft">{m.agent.connectHint}</span>
            </span>
          </button>
        </div>
      )}

      {/* A computer with several agents: pick which one does the work. */}
      {selectedRunner && selectedRunner.agents.length > 1 && chosen?.kind === "local" && (
        <div className="mt-3 flex flex-wrap items-center gap-2" role="radiogroup" aria-label={AGENT_LABELS[chosen.agent]}>
          {selectedRunner.agents.map((agent) => (
            <button
              key={agent}
              type="button"
              role="radio"
              aria-checked={chosen.agent === agent}
              onClick={() => setTarget({ ...chosen, agent })}
              className={cn(
                "h-8 rounded-full border px-3 text-[13px] font-medium transition",
                chosen.agent === agent
                  ? "border-accent-ink/60 bg-accent-soft text-ink"
                  : "border-line text-ink-soft hover:border-line-strong hover:text-ink",
              )}
            >
              {AGENT_LABELS[agent]}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="lg" onClick={start} disabled={!chosen || actions.start.isPending}>
          <SparkleIcon size={17} weight="fill" aria-hidden />
          {actions.start.isPending ? m.agent.starting : m.agent.getOptions}
        </Button>
        {onBack && (
          <Button variant="ghost" onClick={onBack}>
            {m.common.cancel}
          </Button>
        )}
      </div>

      <ComputersDialog open={computersOpen} onClose={() => setComputersOpen(false)} />
    </div>
  );
}

// ---------- A run in progress ----------

function RunView({
  run,
  actions,
  notebook,
  onNewRun,
}: {
  run: IdeaRun;
  actions: RunActions;
  notebook: NotebookActions;
  onNewRun: () => void;
}) {
  const { m, fmt } = useI18n();
  switch (run.status) {
    case "options_pending":
      return (
        <Working run={run} title={m.agent.findingOptions}>
          <div className="mt-4 grid gap-3 @xl:grid-cols-2" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="shimmer h-32 rounded-field" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </div>
        </Working>
      );
    case "options_ready":
      return (
        <div>
          <h3 className="text-xl font-semibold tracking-tight">{m.agent.pickTitle}</h3>
          <p className="mt-1 text-sm text-ink-soft">{m.agent.pickHint}</p>
          <OptionsPicker run={run} actions={actions} />
        </div>
      );
    case "plan_pending":
      return (
        <Working
          run={run}
          title={run.revision ? fmt(m.agent.revising, { comment: run.revision }) : m.agent.writingPlan}
          subtitle={run.choice ? fmt(m.agent.planFor, { title: run.choice.title }) : undefined}
        >
          <div className="mt-4 space-y-2.5" aria-hidden>
            {[88, 72, 80, 64].map((w, i) => (
              <div key={i} className="shimmer h-4 rounded-full" style={{ width: `${w}%` }} />
            ))}
          </div>
        </Working>
      );
    case "plan_ready":
      return <PlanView run={run} actions={actions} />;
    case "building":
      return (
        <Working
          run={run}
          title={run.kind === "prompt" ? m.prompt.working : m.agent.building}
          subtitle={run.kind === "prompt" ? (run.prompt ?? undefined) : run.plan?.title}
        >
          <ProgressLog lines={run.progress} />
        </Working>
      );
    case "done":
      return <ResultView run={run} actions={actions} notebook={notebook} onNewRun={onNewRun} />;
    case "failed":
      return <FailedView run={run} actions={actions} onNewRun={onNewRun} />;
    default:
      return null;
  }
}

/** Header for a stage an agent is working on, plus the "start the runner" hint when its computer is off. */
function Working({
  run,
  title,
  subtitle,
  children,
}: {
  run: IdeaRun;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { m, fmt } = useI18n();
  const offline = run.target === "local" && run.runner && !run.runner.online && !run.working;
  return (
    <div aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="relative flex h-3 w-3 shrink-0" aria-hidden>
          <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60 motion-reduce:animate-none" />
          <span className="relative h-3 w-3 rounded-full bg-accent" />
        </span>
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      </div>
      {subtitle && <p className="mt-1 pl-6 text-sm text-ink-soft">{subtitle}</p>}
      {offline && (
        <div className="mt-4 rounded-field border border-accent-ink/30 bg-accent-soft/50 p-3.5">
          <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
            <WarningIcon size={16} weight="bold" className="shrink-0 text-accent-ink" aria-hidden />
            {fmt(m.agent.offlineWarning, { name: run.runner!.name })}
          </p>
          <CopyCommand command="node lightbulb.cjs" className="mt-2.5 bg-panel" />
        </div>
      )}
      {children}
    </div>
  );
}

function ProgressLog({ lines }: { lines: string[] }) {
  const { m } = useI18n();
  const box = useRef<HTMLOListElement>(null);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [lines.length]);
  return (
    <div className="mt-4">
      <p className="mb-2 text-[13px] font-medium text-ink-soft">{m.agent.progressTitle}</p>
      {lines.length ? (
        <ol
          ref={box}
          className="max-h-64 space-y-1 overflow-y-auto rounded-field border border-line bg-sunken px-3.5 py-3 font-mono text-[12px] leading-relaxed text-ink-soft"
        >
          {lines.map((line, i) => (
            <li key={`${i}:${line}`} className={cn("break-words", i === lines.length - 1 && "text-ink")}>
              {line}
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-field border border-dashed border-line px-3.5 py-3 text-[13px] text-ink-faint">
          {m.agent.progressEmpty}
        </p>
      )}
    </div>
  );
}

// ---------- Options ----------

function OptionCard({
  option,
  selected,
  onSelect,
}: {
  option: AgentOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const { m } = useI18n();
  return (
    <div
      className={cn(
        "flex flex-col rounded-field border transition",
        selected ? "border-accent-ink/60 bg-accent-soft/40 ring-4 ring-accent/20" : "border-line bg-panel hover:border-line-strong",
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className="flex flex-1 flex-col gap-2 p-4 text-left active:scale-[0.995]"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="text-[15px] font-semibold leading-snug tracking-tight text-ink">{option.title}</span>
          <span
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition",
              selected ? "border-accent bg-accent text-on-accent" : "border-line-strong text-transparent",
            )}
            aria-hidden
          >
            <CheckIcon size={11} weight="bold" />
          </span>
        </span>
        <span className="text-[13.5px] leading-relaxed text-ink-soft">{option.summary}</span>
        <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          <span className="rounded-full bg-sunken px-2 py-0.5 text-[11.5px] font-medium text-ink">
            {m.agent.effort[option.effort]}
          </span>
          {option.stack.map((item) => (
            <span key={item} className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-ink-soft">
              {item}
            </span>
          ))}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {selected && (option.approach || option.tradeoff) && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="border-t border-line/70 px-4 pb-4 pt-3 text-[13px] leading-relaxed text-ink-soft"
          >
            {option.approach && (
              <p>
                <span className="font-medium text-ink">{m.agent.more}. </span>
                {option.approach}
              </p>
            )}
            {option.tradeoff && (
              <p className="mt-2">
                <span className="font-medium text-ink">{m.agent.tradeoff}: </span>
                {option.tradeoff}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function OptionsPicker({ run, actions, compact = false }: { run: IdeaRun; actions: RunActions; compact?: boolean }) {
  const { m, errorText } = useI18n();
  const toast = useToast();
  const [selected, setSelected] = useState<number | null>(compact ? null : (run.choice?.index ?? null));
  const [comment, setComment] = useState("");
  const options = run.options ?? [];

  const submit = () => {
    if (selected === null) return;
    actions.choose.mutate(
      { runId: run.id, index: selected, comment: comment.trim() || undefined },
      { onError: (err) => toast({ tone: "error", message: errorText(err) }) },
    );
  };

  return (
    <div className="mt-4">
      <div role="radiogroup" aria-label={m.agent.pickTitle} className="grid gap-3 @xl:grid-cols-2">
        {options.map((option, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: i * 0.05 }}
            className="flex"
          >
            <div className="flex-1">
              <OptionCard option={option} selected={selected === i} onSelect={() => setSelected(i)} />
            </div>
          </motion.div>
        ))}
      </div>

      <AnimatePresence initial={false}>
        {selected !== null && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4">
            <label htmlFor={`comment-${run.id}`} className="text-[13px] font-medium text-ink-soft">
              {m.agent.commentLabel}
            </label>
            <textarea
              id={`comment-${run.id}`}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={AGENT_LIMITS.commentChars}
              rows={2}
              placeholder={m.agent.commentPlaceholder}
              className="mt-2 block w-full resize-none rounded-field border border-line bg-panel px-3.5 py-2.5 text-[14px] leading-relaxed text-ink outline-none transition [field-sizing:content] placeholder:text-ink-faint focus:border-accent-ink focus:ring-4 focus:ring-accent/25"
            />
            <Button variant="primary" size={compact ? "md" : "lg"} className="mt-3" onClick={submit} disabled={actions.choose.isPending}>
              <PaperPlaneRightIcon size={16} weight="fill" aria-hidden />
              {compact ? m.agent.useThis : m.agent.writePlan}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------- Plan ----------

function PlanList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-field bg-sunken/60 p-4">
      <h4 className="text-[13px] font-semibold text-ink">{title}</h4>
      <ul className="mt-2 space-y-1.5 text-[13.5px] leading-relaxed text-ink-soft">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanView({ run, actions }: { run: IdeaRun; actions: RunActions }) {
  const { m, fmt, errorText } = useI18n();
  const toast = useToast();
  const agents = useAgents();
  const [mode, setMode] = useState<"read" | "revise" | "options">("read");
  const [changes, setChanges] = useState("");
  const plan = run.plan!;
  const onError = (err: Error) => toast({ tone: "error", message: errorText(err) });

  const approve = () => actions.approve.mutate({ runId: run.id, planVersion: run.planVersion }, { onError });
  const revise = () => {
    const comment = changes.trim();
    if (comment) actions.revise.mutate({ runId: run.id, comment }, { onError });
  };

  return (
    <div>
      {run.choice && <p className="text-[13px] font-medium text-accent-ink">{fmt(m.agent.planFor, { title: run.choice.title })}</p>}
      <h3 className="mt-1 text-2xl font-semibold leading-snug tracking-tight">{plan.title}</h3>
      <p className="mt-2 max-w-[65ch] text-[15px] leading-relaxed text-ink-soft">{plan.summary}</p>

      <h4 className="mt-6 text-[13px] font-semibold text-ink">{m.agent.steps}</h4>
      <ol className="mt-3 space-y-4">
        {plan.steps.map((step, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: Math.min(i, 8) * 0.04 }}
            className="flex gap-3.5"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-[12px] font-semibold text-accent-ink">
              {i + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[15px] font-medium leading-snug text-ink">{step.title}</p>
              {step.detail && <p className="mt-1 text-[13.5px] leading-relaxed text-ink-soft">{step.detail}</p>}
            </div>
          </motion.li>
        ))}
      </ol>

      {(plan.deliverables.length > 0 || plan.risks.length > 0 || plan.questions.length > 0) && (
        <div className="mt-6 grid gap-3 @xl:grid-cols-2">
          <PlanList title={m.agent.deliverables} items={plan.deliverables} />
          <PlanList title={m.agent.risks} items={plan.risks} />
          <PlanList title={m.agent.questions} items={plan.questions} />
        </div>
      )}

      <div className="mt-6 border-t border-line pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="lg" onClick={approve} disabled={actions.approve.isPending}>
            <CheckCircleIcon size={18} weight="fill" aria-hidden />
            {actions.approve.isPending ? m.agent.approving : m.agent.approve}
          </Button>
          <Button onClick={() => setMode(mode === "revise" ? "read" : "revise")}>{m.agent.requestChanges}</Button>
          <Button variant="ghost" onClick={() => setMode(mode === "options" ? "read" : "options")}>
            {mode === "options" ? m.agent.hideOptions : m.agent.otherOptions}
          </Button>
        </div>
        <p className="mt-2.5 text-[13px] text-ink-faint">
          {run.target === "cloud"
            ? fmt(m.agent.approveHintCloud, { budget: agents.data?.cloud.budgetUsd ?? "" })
            : fmt(m.agent.approveHintLocal, { name: run.runner?.name ?? "" })}
        </p>

        <AnimatePresence initial={false} mode="wait">
          {mode === "revise" && (
            <motion.div key="revise" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4">
              <label htmlFor={`changes-${run.id}`} className="text-[13px] font-medium text-ink-soft">
                {m.agent.changesLabel}
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
                <textarea
                  id={`changes-${run.id}`}
                  autoFocus
                  value={changes}
                  onChange={(e) => setChanges(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      revise();
                    }
                  }}
                  maxLength={AGENT_LIMITS.commentChars}
                  rows={2}
                  placeholder={m.agent.changesPlaceholder}
                  className="block w-full flex-1 resize-none rounded-field border border-line bg-panel px-3.5 py-2.5 text-[14px] leading-relaxed text-ink outline-none transition [field-sizing:content] placeholder:text-ink-faint focus:border-accent-ink focus:ring-4 focus:ring-accent/25"
                />
                <Button onClick={revise} disabled={!changes.trim() || actions.revise.isPending}>
                  <PaperPlaneRightIcon size={15} weight="fill" aria-hidden /> {m.agent.sendChanges}
                </Button>
              </div>
            </motion.div>
          )}
          {mode === "options" && (
            <motion.div key="options" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <OptionsPicker run={run} actions={actions} compact />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------- Outcomes ----------

function ResultView({
  run,
  actions,
  notebook,
  onNewRun,
}: {
  run: IdeaRun;
  actions: RunActions;
  notebook: NotebookActions;
  onNewRun: () => void;
}) {
  const { m, errorText } = useI18n();
  const toast = useToast();
  const [added, setAdded] = useState<Set<number>>(new Set());
  const result = run.result!;

  const addStep = (text: string, i: number) =>
    notebook.addStep.mutate(text, {
      onSuccess: () => {
        setAdded((prev) => new Set(prev).add(i));
        toast({ tone: "success", message: m.agent.stepAdded });
      },
      onError: (err) => toast({ tone: "error", message: errorText(err) }),
    });

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <SealCheckIcon size={26} weight="fill" className="text-accent-ink" aria-hidden />
        <h3 className="text-xl font-semibold tracking-tight">{m.agent.doneTitle}</h3>
      </div>
      {run.kind === "prompt" && run.prompt ? (
        <p className="mt-1 line-clamp-2 text-sm text-ink-soft">“{run.prompt}”</p>
      ) : (
        run.plan && <p className="mt-1 text-sm text-ink-soft">{run.plan.title}</p>
      )}
      <p className="mt-4 max-w-[65ch] whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{result.summary}</p>

      {result.location && (
        <div className="mt-5">
          <p className="mb-2 text-[13px] font-medium text-ink-soft">{m.agent.location}</p>
          <CopyCommand command={result.location} />
        </div>
      )}

      {result.files.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-[13px] font-medium text-ink-soft">{m.agent.savedFiles}</p>
          <ul className="flex flex-wrap gap-2">
            {result.files.map((file) => (
              <li key={file.id}>
                <a
                  href={`/api/files/${file.id}`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-medium text-ink transition hover:border-line-strong hover:bg-sunken"
                >
                  <FileIcon size={14} aria-hidden /> {file.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <PublishRow run={run} actions={actions} />

      {result.followUps.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-[13px] font-semibold text-ink">{m.agent.followUps}</p>
          <ul className="space-y-2">
            {result.followUps.map((text, i) => (
              <li key={i} className="flex items-center gap-3 rounded-field bg-sunken/60 py-2 pl-3.5 pr-2">
                <span className="min-w-0 flex-1 text-[14px] text-ink">{text}</span>
                {added.has(i) ? (
                  <span className="flex items-center gap-1 px-2 text-[12.5px] font-medium text-accent-ink">
                    <CheckIcon size={13} weight="bold" aria-hidden /> {m.agent.stepAdded}
                  </span>
                ) : (
                  <Button size="sm" onClick={() => addStep(text, i)} disabled={notebook.addStep.isPending}>
                    <PlusIcon size={13} weight="bold" aria-hidden /> {m.agent.addStep}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button className="mt-6" onClick={onNewRun}>
        <SparkleIcon size={15} aria-hidden /> {m.agent.newRun}
      </Button>
    </div>
  );
}

function FailedView({ run, actions, onNewRun }: { run: IdeaRun; actions: RunActions; onNewRun: () => void }) {
  const { m, errorText } = useI18n();
  const toast = useToast();
  const error = run.error;
  const hint = error?.code ? m.agent.failHints[error.code] : undefined;
  const canRetry = !(run.target === "local" && !run.runner);

  return (
    <div role="alert">
      <div className="flex items-center gap-2.5">
        <WarningIcon size={24} weight="fill" className="text-danger" aria-hidden />
        <h3 className="text-xl font-semibold tracking-tight">{m.agent.failedTitle}</h3>
      </div>
      {error && <p className="mt-1 text-[13px] font-medium text-ink-soft">{m.agent.failedAt[error.stage]}</p>}
      {error && <p className="mt-3 max-w-[65ch] text-[15px] leading-relaxed text-ink">{error.message}</p>}
      {hint && <p className="mt-1.5 text-sm text-ink-soft">{hint}</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        {canRetry && (
          <Button
            variant="primary"
            onClick={() =>
              actions.retry.mutate(run.id, { onError: (err) => toast({ tone: "error", message: errorText(err) }) })
            }
            disabled={actions.retry.isPending}
          >
            <ArrowClockwiseIcon size={16} weight="bold" aria-hidden /> {m.agent.retry}
          </Button>
        )}
        <Button onClick={onNewRun}>{m.agent.newRun}</Button>
      </div>
    </div>
  );
}

function History({ run }: { run: IdeaRun }) {
  const { m, fmt, timeAgo, fullDate } = useI18n();
  return (
    <details className="group mt-6 border-t border-line pt-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] font-medium text-ink-soft transition hover:text-ink">
        <ClockCounterClockwiseIcon size={15} aria-hidden />
        {m.agent.history}
      </summary>
      <ol className="mt-3 space-y-2">
        {[...run.events].reverse().map((event) => (
          <li key={event.id} className="flex items-baseline gap-3 text-[13px]">
            <span className="w-24 shrink-0 text-ink-faint" title={fullDate(event.createdAt)}>
              {timeAgo(event.createdAt)}
            </span>
            <span className="min-w-0 text-ink-soft">{fmt(m.agent.events[event.kind], { text: event.text ?? "" })}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Publish the build's project zip to a new GitHub repository, or open the one it went to. */
function PublishRow({ run, actions }: { run: IdeaRun; actions: RunActions }) {
  const { m, errorText } = useI18n();
  const toast = useToast();
  const integrations = useIntegrations();
  const result = run.result!;
  const hasZip = result.files.some((f) => f.name.toLowerCase().endsWith(".zip"));
  const github = integrations.data?.integrations.some((i) => i.provider === "github");

  if (result.repo) {
    return (
      <a
        href={result.repo.url}
        target="_blank"
        rel="noreferrer"
        className="mt-5 inline-flex h-10 items-center gap-2 rounded-full border border-line bg-panel px-4 text-sm font-medium text-ink transition hover:border-line-strong hover:bg-sunken"
      >
        <GithubLogoIcon size={17} weight="fill" aria-hidden />
        {m.agent.openRepo}
        <span className="font-mono text-[12px] text-ink-faint">{result.repo.fullName}</span>
      </a>
    );
  }
  if (!hasZip || integrations.isPending) return null;
  if (!github) {
    return (
      <Link
        to="/integrations"
        className="mt-5 inline-flex h-10 items-center gap-2 rounded-full border border-dashed border-line-strong px-4 text-sm font-medium text-ink-soft transition hover:border-accent-ink/60 hover:text-ink"
      >
        <GithubLogoIcon size={17} aria-hidden />
        {m.agent.connectGithub}
      </Link>
    );
  }
  return (
    <Button
      className="mt-5"
      onClick={() =>
        actions.publish.mutate(run.id, {
          onSuccess: () => toast({ tone: "success", message: m.agent.published }),
          onError: (err) => toast({ tone: "error", message: errorText(err) }),
        })
      }
      disabled={actions.publish.isPending}
    >
      <GithubLogoIcon size={17} weight="fill" aria-hidden />
      {actions.publish.isPending ? m.agent.publishing : m.agent.publish}
    </Button>
  );
}

/** Where agents work on this project: a new folder in ~/Lightbulb, or a repo you already have. */
function ProjectFolderField({ ideaId, projectPath }: { ideaId: string; projectPath: string | null }) {
  const { m, errorText } = useI18n();
  const toast = useToast();
  const update = useUpdateIdea();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(projectPath ?? "");

  const save = (path: string | null) =>
    update.mutate(
      { id: ideaId, body: { projectPath: path } },
      {
        onSuccess: () => {
          setEditing(false);
          toast({ tone: "success", message: m.projectFolder.saved });
        },
        onError: (err) => toast({ tone: "error", message: errorText(err) }),
      },
    );

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
        <span className="font-medium text-ink-soft">{m.projectFolder.label}</span>
        <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-ink">
          <FolderOpenIcon size={15} className="shrink-0 text-accent-ink" aria-hidden />
          {projectPath ? (
            <code className="truncate font-mono text-[12.5px]" title={projectPath}>
              {projectPath}
            </code>
          ) : (
            <span className="text-ink-faint">{m.projectFolder.none}</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => {
            setValue(projectPath ?? "");
            setEditing(true);
          }}
          className="font-medium text-accent-ink underline-offset-4 hover:underline"
        >
          {projectPath ? m.projectFolder.change : m.projectFolder.set}
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim().length >= 2) save(value.trim());
      }}
    >
      <label htmlFor={`folder-${ideaId}`} className="text-[13px] font-medium text-ink-soft">
        {m.projectFolder.label}
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id={`folder-${ideaId}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={m.projectFolder.placeholder}
          spellCheck={false}
          autoFocus
          maxLength={400}
          className="h-10 w-full min-w-0 rounded-field border border-line bg-panel px-3.5 font-mono text-[13px] text-ink outline-none transition placeholder:text-ink-faint focus:border-accent-ink focus:ring-4 focus:ring-accent/25"
        />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" size="sm" className="h-10" disabled={value.trim().length < 2 || update.isPending}>
            {m.common.save}
          </Button>
          {projectPath && (
            <Button size="sm" className="h-10" onClick={() => save(null)} disabled={update.isPending}>
              {m.projectFolder.clear}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-10" onClick={() => setEditing(false)}>
            {m.common.cancel}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-faint">{m.projectFolder.hint}</p>
    </form>
  );
}
