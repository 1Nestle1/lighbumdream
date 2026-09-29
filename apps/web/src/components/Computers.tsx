import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, DesktopTowerIcon, TerminalWindowIcon, TrashIcon } from "@phosphor-icons/react";
import type { Runner } from "@lightbulb/shared";
import { AGENT_LABELS } from "@lightbulb/shared/constants";
import { useI18n } from "../i18n";
import { api } from "../lib/api";
import { cn } from "../lib/format";
import { keys, useAgents } from "../lib/queries";
import { useToast } from "./Toaster";
import { Button, Dialog, DialogHeader, IconButton } from "./ui";

const isWindows = () => /win/i.test(navigator.userAgent) && !/darwin|mac/i.test(navigator.userAgent);

export const runnerCommands = () => {
  const url = `${window.location.origin}/api/runner/cli`;
  return {
    windows: `iwr ${url} -OutFile lightbulb.cjs; node lightbulb.cjs`,
    unix: `curl -fsSL ${url} -o lightbulb.cjs && node lightbulb.cjs`,
  };
};

/** A command in a terminal-style box with a copy button. */
export function CopyCommand({ command, className }: { command: string; className?: string }) {
  const { m } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked; the command stays selectable.
    }
  };
  return (
    <div className={cn("flex items-start gap-2 rounded-field border border-line bg-sunken py-2 pl-3.5 pr-2", className)}>
      <code className="min-w-0 flex-1 select-all break-all py-1 font-mono text-[12.5px] leading-relaxed text-ink">{command}</code>
      <IconButton label={copied ? m.computers.copied : m.computers.copy} size="sm" onClick={copy}>
        {copied ? <CheckIcon size={15} weight="bold" className="text-accent-ink" /> : <CopyIcon size={15} />}
      </IconButton>
    </div>
  );
}

function ConnectSteps() {
  const { m } = useI18n();
  const [os, setOs] = useState<"windows" | "unix">(isWindows() ? "windows" : "unix");
  const commands = runnerCommands();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-relaxed text-ink-soft">{m.computers.needs}</p>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-[13px] font-medium text-ink">{m.computers.run}</p>
        <div role="tablist" className="flex rounded-full border border-line bg-sunken p-0.5">
          {(["windows", "unix"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={os === key}
              onClick={() => setOs(key)}
              className={cn(
                "whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition",
                os === key ? "bg-panel text-ink shadow-card" : "text-ink-soft hover:text-ink",
              )}
            >
              {m.computers[key]}
            </button>
          ))}
        </div>
      </div>
      <CopyCommand command={commands[os]} />
      <p className="text-[13px] leading-relaxed text-ink-soft">{m.computers.confirm}</p>
    </div>
  );
}

function RunnerRow({ runner }: { runner: Runner }) {
  const { m, fmt, timeAgo, errorText } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.removeRunner(runner.id),
    onSuccess: () => {
      toast({ tone: "success", message: m.computers.removed });
      void qc.invalidateQueries({ queryKey: keys.agents });
      void qc.invalidateQueries({ queryKey: ["runs"] });
    },
    onError: (err) => toast({ tone: "error", message: errorText(err) }),
  });

  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex items-start gap-3 py-3"
    >
      <span
        className={cn(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          runner.online ? "bg-accent-soft text-accent-ink" : "bg-sunken text-ink-faint",
        )}
      >
        <DesktopTowerIcon size={18} weight={runner.online ? "fill" : "regular"} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{runner.name}</p>
        <p className="mt-0.5 text-[12.5px] text-ink-soft">
          {runner.online
            ? m.agent.online
            : runner.lastSeenAt
              ? fmt(m.computers.seen, { ago: timeAgo(runner.lastSeenAt) })
              : m.computers.never}
          {runner.agents.length > 0 && <> · {runner.agents.map((a) => AGENT_LABELS[a]).join(", ")}</>}
        </p>
      </div>
      {confirming ? (
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            {m.common.keep}
          </Button>
          <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {m.computers.remove}
          </Button>
        </div>
      ) : (
        <IconButton label={m.computers.remove} size="sm" onClick={() => setConfirming(true)}>
          <TrashIcon size={15} />
        </IconButton>
      )}
    </motion.li>
  );
}

export function ComputersDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { m } = useI18n();
  const agents = useAgents({ live: open });
  const runners = agents.data?.runners ?? [];

  return (
    <Dialog open={open} onClose={onClose} title={m.computers.title} className="max-w-lg">
      <DialogHeader title={m.computers.title} onClose={onClose} />
      <div className="max-h-[70vh] overflow-y-auto px-5 pb-5">
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{m.computers.intro}</p>

        {agents.isPending ? (
          <div className="mt-4 space-y-2" aria-hidden>
            <div className="shimmer h-12 rounded-field" />
          </div>
        ) : runners.length ? (
          <ul className="mt-2 divide-y divide-line">
            <AnimatePresence initial={false}>
              {runners.map((runner) => (
                <RunnerRow key={runner.id} runner={runner} />
              ))}
            </AnimatePresence>
          </ul>
        ) : (
          <p className="mt-4 rounded-field bg-sunken/70 px-3.5 py-3 text-[13px] text-ink-soft">{m.computers.empty}</p>
        )}

        <div className="mt-5 rounded-card border border-line bg-panel p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight">
            <TerminalWindowIcon size={17} weight="bold" className="text-accent-ink" aria-hidden />
            {m.computers.connectTitle}
          </h3>
          <ConnectSteps />
        </div>
      </div>
    </Dialog>
  );
}

/** Sidebar entry: how many computers are online, opens the dialog. */
export function ComputersNav() {
  const { m, plural } = useI18n();
  const [open, setOpen] = useState(false);
  const agents = useAgents();
  const online = agents.data?.runners.filter((r) => r.online).length ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex h-10 items-center gap-2.5 rounded-field px-3 text-sm text-ink-soft transition hover:bg-sunken hover:text-ink"
      >
        <DesktopTowerIcon size={18} aria-hidden />
        <span className="flex-1 text-left">{m.computers.sidebar}</span>
        {online > 0 && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-ink">
            {plural(m.computers.sidebarOnline, online)}
          </span>
        )}
      </button>
      <ComputersDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
