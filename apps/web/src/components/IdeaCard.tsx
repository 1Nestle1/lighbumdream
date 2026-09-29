import type { PointerEvent } from "react";
import { FootprintsIcon, MicrophoneIcon, TrayIcon } from "@phosphor-icons/react";
import type { FolderIcon, Idea } from "@lightbulb/shared";
import { SNIPPET_MARK_END, SNIPPET_MARK_START } from "@lightbulb/shared/constants";
import { useI18n } from "../i18n";
import { cn } from "../lib/format";
import { FolderGlyph } from "./FolderIcon";

export interface CardFolder {
  name: string;
  icon: FolderIcon;
}

/** Renders a search snippet with highlighted matches, without injecting HTML. */
export function Highlighted({ text }: { text: string }) {
  const parts = text.split(new RegExp(`(${SNIPPET_MARK_START}[^${SNIPPET_MARK_END}]*${SNIPPET_MARK_END})`));
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith(SNIPPET_MARK_START) ? (
          <mark key={i}>{part.slice(1, -1)}</mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function FolderChip({ folder, className }: { folder: CardFolder | null; className?: string }) {
  const { m } = useI18n();
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        folder ? "bg-sunken text-ink-soft" : "bg-accent-soft text-accent-ink",
        className,
      )}
    >
      {folder ? (
        <FolderGlyph name={folder.icon} size={13} weight="bold" />
      ) : (
        <TrayIcon size={13} weight="bold" aria-hidden />
      )}
      <span className="truncate">{folder ? folder.name : m.card.inbox}</span>
    </span>
  );
}

export function IdeaCard({
  idea,
  folder,
  onOpen,
  className,
}: {
  idea: Pick<Idea, "title" | "body" | "createdAt" | "snippet"> & Partial<Pick<Idea, "nextStep" | "hasAudio">>;
  folder: CardFolder | null;
  onOpen?: () => void;
  className?: string;
}) {
  const { m, timeAgo } = useI18n();
  // Spotlight follows the cursor via CSS variables: no React re-render per move.
  const track = (e: PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - rect.top}px`);
  };

  const Tag = onOpen ? "button" : "article";
  return (
    <Tag
      {...(onOpen ? { type: "button" as const, onClick: onOpen } : {})}
      onPointerMove={track}
      className={cn(
        "group relative block w-full overflow-hidden rounded-card border border-line bg-panel p-5 text-left shadow-card",
        "transition-[transform,border-color,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
        onOpen && "cursor-pointer hover:-translate-y-0.5 hover:border-line-strong hover:shadow-float",
        className,
      )}
    >
      <span className="spotlight" aria-hidden />
      <span className="relative flex items-center justify-between gap-3">
        <FolderChip folder={folder} />
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-ink-faint">
          {idea.hasAudio && <MicrophoneIcon size={12} weight="bold" aria-label={m.card.voice} />}
          <time dateTime={idea.createdAt}>{timeAgo(idea.createdAt)}</time>
        </span>
      </span>
      <span className="relative mt-3.5 block text-[17px] font-semibold leading-snug tracking-tight text-ink">
        {idea.title}
      </span>
      <span className="relative mt-2 line-clamp-5 block whitespace-pre-line text-sm leading-relaxed text-ink-soft">
        {idea.snippet ? <Highlighted text={idea.snippet} /> : idea.body}
      </span>
      {idea.nextStep && (
        <span className="relative mt-4 flex items-start gap-2 rounded-field bg-sunken/70 px-3 py-2 text-[13px] leading-snug text-ink">
          <FootprintsIcon size={15} weight="bold" className="mt-px shrink-0 text-accent-ink" aria-hidden />
          <span className="line-clamp-2">
            <span className="sr-only">{m.card.nextStep} </span>
            {idea.nextStep}
          </span>
        </span>
      )}
    </Tag>
  );
}

export function IdeaCardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="mb-4 break-inside-avoid rounded-card border border-line bg-panel p-5" aria-hidden>
      <div className="flex items-center justify-between">
        <div className="shimmer h-6 w-24 rounded-full" />
        <div className="shimmer h-3 w-12 rounded-full" />
      </div>
      <div className="shimmer mt-4 h-5 w-3/4 rounded-md" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="shimmer h-3.5 rounded-md" style={{ width: `${92 - i * 14}%` }} />
        ))}
      </div>
    </div>
  );
}
