import { useMemo, useState, type FormEvent } from "react";
import { CaretDownIcon, PaperPlaneRightIcon } from "@phosphor-icons/react";
import type { AgentKind } from "@lightbulb/shared";
import { AGENT_LABELS, LIMITS } from "@lightbulb/shared/constants";
import { useI18n } from "../i18n";
import { cn, modKey } from "../lib/format";
import { useAgents, useSendPrompt } from "../lib/queries";
import { ComputersDialog } from "./Computers";
import { useToast } from "./Toaster";
import { Button, Kbd } from "./ui";

const TARGET_KEY = "lb-agent-target";

function rememberedRunner(): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(TARGET_KEY) ?? "null") as { kind?: string; runnerId?: string } | null;
    return saved?.kind === "local" ? (saved.runnerId ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * Write what an agent should do next on this project and send it to one of your computers.
 * It runs at once: your prompt is the instruction, there's no plan to approve.
 */
export function PromptComposer({
  ideaId,
  busy,
  preferredRunnerId,
  compact = false,
  className,
}: {
  ideaId: string;
  /** An agent is already working on the project: one thing at a time. */
  busy: boolean;
  /** The computer the project last ran on. */
  preferredRunnerId?: string | null;
  compact?: boolean;
  className?: string;
}) {
  const { m, fmt, rich, errorText } = useI18n();
  const toast = useToast();
  const agents = useAgents();
  const send = useSendPrompt(ideaId);
  const [text, setText] = useState("");
  const [choice, setChoice] = useState<string | null>(null);
  const [computersOpen, setComputersOpen] = useState(false);

  const targets = useMemo(
    () =>
      (agents.data?.runners ?? []).flatMap((runner) =>
        runner.agents.map((agent) => ({ value: `${runner.id}:${agent}`, runner, agent })),
      ),
    [agents.data],
  );

  // Default: the computer the project last ran on, then your last choice, then any online one.
  const fallback = useMemo(() => {
    const preferred = [preferredRunnerId, rememberedRunner()].filter(Boolean);
    for (const id of preferred) {
      const hit = targets.find((t) => t.runner.id === id);
      if (hit) return hit.value;
    }
    return (targets.find((t) => t.runner.online) ?? targets[0])?.value ?? null;
  }, [targets, preferredRunnerId]);
  const selected = targets.find((t) => t.value === (choice ?? fallback));

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const prompt = text.trim();
    if (!prompt || !selected || busy) return;
    send.mutate(
      { prompt, runnerId: selected.runner.id, agent: selected.agent as AgentKind },
      {
        onSuccess: () => {
          setText("");
          toast({ tone: "success", message: fmt(m.prompt.sent, { name: selected.runner.name }) });
        },
        onError: (err) => toast({ tone: "error", message: errorText(err) }),
      },
    );
  };

  if (agents.data && !targets.length) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={() => setComputersOpen(true)}
          className="w-full rounded-field border border-dashed border-line-strong px-3.5 py-3 text-left text-[13px] font-medium text-ink-soft transition hover:border-accent-ink/60 hover:text-ink"
        >
          {m.prompt.noComputers}
        </button>
        <ComputersDialog open={computersOpen} onClose={() => setComputersOpen(false)} />
      </div>
    );
  }

  const fieldId = `prompt-${ideaId}`;
  return (
    <form onSubmit={submit} className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={fieldId} className="sr-only">
        {m.prompt.label}
      </label>
      <textarea
        id={fieldId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
        }}
        maxLength={LIMITS.promptChars}
        rows={compact ? 2 : 3}
        disabled={busy}
        placeholder={busy ? m.prompt.busy : m.prompt.placeholder}
        className={cn(
          "block max-h-40 w-full resize-none rounded-field border border-line bg-panel px-3.5 py-2.5 text-[14px] leading-relaxed text-ink outline-none transition [field-sizing:content] placeholder:text-ink-faint focus:border-accent-ink focus:ring-4 focus:ring-accent/25 disabled:cursor-not-allowed disabled:bg-sunken/60",
          compact ? "min-h-[64px]" : "min-h-[88px]",
        )}
      />
      <div className="flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{m.prompt.computer}</span>
          <select
            value={selected?.value ?? ""}
            onChange={(e) => setChoice(e.target.value)}
            disabled={busy || !targets.length}
            className="h-9 w-full min-w-0 appearance-none truncate rounded-full border border-line bg-panel pl-3 pr-8 text-[12.5px] font-medium text-ink outline-none transition hover:border-line-strong focus:border-accent-ink disabled:opacity-60"
          >
            {targets.map((t) => (
              <option key={t.value} value={t.value}>
                {t.runner.name} · {AGENT_LABELS[t.agent]}
                {t.runner.online ? "" : ` (${m.prompt.offline})`}
              </option>
            ))}
          </select>
          <CaretDownIcon size={12} weight="bold" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden />
        </label>
        <Button type="submit" variant="primary" size="sm" disabled={busy || !text.trim() || !selected || send.isPending}>
          <PaperPlaneRightIcon size={14} weight="fill" aria-hidden />
          {send.isPending ? m.prompt.sending : m.prompt.send}
        </Button>
      </div>
      {!compact && !busy && (
        <p className="hidden items-center gap-1 text-[11px] text-ink-faint md:flex">
          {rich(m.prompt.hint, { mod: <Kbd>{modKey}</Kbd>, enter: <Kbd>Enter</Kbd> })}
        </p>
      )}
    </form>
  );
}
