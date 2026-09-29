import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowsClockwiseIcon,
  DotsThreeIcon,
  SparkleIcon,
  TrashIcon,
  LightningIcon,
  FootprintsIcon,
} from "@phosphor-icons/react";
import type { Folder, FolderChoice, Idea } from "@lightbulb/shared";
import { useI18n } from "../i18n";
import { cn, modKey } from "../lib/format";
import { useConfirmIdea, useDeleteIdea, useResuggest, useUpdateIdea } from "../lib/queries";
import { FolderGlyph } from "./FolderIcon";
import { ChoiceCheck, FolderPickerDialog } from "./FolderDialogs";
import { useToast } from "./Toaster";
import { Button, IconButton, Kbd } from "./ui";

const choiceKey = (c: FolderChoice) => (c.kind === "existing" ? c.folderId : `new:${c.name.toLowerCase()}`);

/** A suggested folder may have been deleted since; offer it as a new folder instead. */
function reconcile(choice: FolderChoice, folders: Folder[]): FolderChoice {
  if (choice.kind === "new") {
    const match = folders.find((f) => f.name.toLowerCase() === choice.name.toLowerCase());
    return match ? { kind: "existing", folderId: match.id, name: match.name, icon: match.icon } : choice;
  }
  const live = folders.find((f) => f.id === choice.folderId);
  return live
    ? { kind: "existing", folderId: live.id, name: live.name, icon: live.icon }
    : { kind: "new", name: choice.name, icon: choice.icon };
}

/**
 * The confirm step: shows the suggested title + folder, lets the user pick another,
 * and files the idea only when they confirm.
 */
export function SuggestionCard({
  idea,
  folders,
  highlight = false,
  embedded = false,
}: {
  idea: Idea;
  folders: Folder[];
  highlight?: boolean;
  embedded?: boolean;
}) {
  const { m, fmt, rich, timeAgo, errorText } = useI18n();
  const toast = useToast();
  const confirm = useConfirmIdea();
  const update = useUpdateIdea();
  const resuggest = useResuggest();
  const remove = useDeleteIdea();

  const suggestion = idea.suggestion;
  const choices = useMemo(() => {
    if (!suggestion) return [];
    const seen = new Set<string>();
    return [suggestion.primary, ...suggestion.alternatives]
      .map((c) => reconcile(c, folders))
      .filter((c) => (seen.has(choiceKey(c)) ? false : (seen.add(choiceKey(c)), true)));
  }, [suggestion, folders]);

  const [title, setTitle] = useState(idea.title);
  // Selection is stored by key and derived on render, so it survives folders loading late.
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [custom, setCustom] = useState<FolderChoice | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // New suggestion arrived (re-suggest): go back to its primary.
  useEffect(() => {
    setPickedKey(null);
    setCustom(null);
  }, [suggestion?.createdAt]);
  useEffect(() => setTitle(idea.title), [idea.title]);

  const extra = custom ? reconcile(custom, folders) : null;
  const options = extra && !choices.some((c) => choiceKey(c) === choiceKey(extra)) ? [...choices, extra] : choices;
  const picked = (pickedKey ? options.find((c) => choiceKey(c) === pickedKey) : undefined) ?? options[0] ?? null;
  const setPicked = (choice: FolderChoice) => setPickedKey(choiceKey(choice));
  const pickCustom = (choice: FolderChoice) => {
    setCustom(choice);
    setPickedKey(choiceKey(reconcile(choice, folders)));
  };

  const file = () => {
    if (!picked || confirm.isPending) return;
    const body = {
      title: title.trim() && title.trim() !== idea.title ? title.trim() : undefined,
      target:
        picked.kind === "existing"
          ? ({ kind: "existing", folderId: picked.folderId } as const)
          : ({ kind: "new", name: picked.name, icon: picked.icon } as const),
    };
    confirm.mutate(
      { id: idea.id, body },
      {
        onSuccess: ({ folder }) =>
          toast({
            tone: "success",
            message: fmt(m.suggestion.filedIn, { folder: folder.name }),
            action: {
              label: m.common.undo,
              onClick: () => update.mutate({ id: idea.id, body: { folderId: null } }),
            },
          }),
        onError: (err) => toast({ tone: "error", message: errorText(err) }),
      },
    );
  };

  const discard = () =>
    remove.mutate(idea.id, {
      onSuccess: () => toast({ tone: "success", message: m.suggestion.deleted }),
      onError: (err) => toast({ tone: "error", message: errorText(err) }),
    });

  const busy = confirm.isPending || remove.isPending;
  const detail = suggestion?.summary && suggestion.summary !== idea.body ? suggestion.summary : idea.body;

  return (
    <motion.section
      layout="position"
      aria-label={fmt(m.suggestion.region, { title: idea.title })}
      initial={{ opacity: 0, y: 18, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}
      transition={{ type: "spring", stiffness: 260, damping: 28 }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          file();
        }
      }}
      className={cn(
        "relative overflow-hidden",
        embedded
          ? "rounded-field border border-line bg-sunken/50 p-4"
          : "rounded-card border bg-panel p-5 shadow-card md:p-6",
        !embedded && (highlight ? "border-accent-ink/40" : "border-line"),
      )}
    >
      {highlight && !embedded && (
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/3 h-48 w-2/3 rounded-full bg-accent/25 blur-3xl"
        />
      )}

      <div className="relative flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-ink">
          {suggestion?.source === "ai" ? (
            <SparkleIcon size={13} weight="fill" aria-hidden />
          ) : (
            <LightningIcon size={13} weight="fill" aria-hidden />
          )}
          {suggestion?.source === "ai" ? m.suggestion.suggested : m.suggestion.quickGuess}
        </span>
        <div className="flex items-center gap-1">
          {!embedded && (
            <time dateTime={idea.createdAt} className="mr-1 font-mono text-[11px] text-ink-faint">
              {timeAgo(idea.createdAt)}
            </time>
          )}
          <IconButton
            label={m.suggestion.suggestAgain}
            size="sm"
            onClick={() => resuggest.mutate(idea.id)}
            disabled={resuggest.isPending}
          >
            <ArrowsClockwiseIcon size={16} className={cn(resuggest.isPending && "animate-spin")} />
          </IconButton>
          {!embedded && (
            <div className="relative">
              <IconButton label={m.suggestion.moreActions} size="sm" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
                <DotsThreeIcon size={18} weight="bold" />
              </IconButton>
              {menuOpen && (
                <div
                  className="absolute right-0 top-9 z-10 w-44 rounded-field border border-line bg-panel p-1 shadow-float"
                  onMouseLeave={() => setMenuOpen(false)}
                >
                  <button
                    type="button"
                    onClick={discard}
                    className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-sm text-danger hover:bg-danger/10"
                  >
                    <TrashIcon size={16} aria-hidden /> {m.suggestion.deleteIdea}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <label htmlFor={`title-${idea.id}`} className="sr-only">
        {m.suggestion.title}
      </label>
      <textarea
        id={`title-${idea.id}`}
        value={title}
        maxLength={120}
        rows={1}
        onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
        onKeyDown={(e) => e.key === "Enter" && !(e.ctrlKey || e.metaKey) && e.preventDefault()}
        className="relative -mx-1 mt-3 block w-[calc(100%+0.5rem)] resize-none rounded-[10px] bg-transparent px-1 text-xl font-semibold leading-snug tracking-tight text-ink outline-none transition [field-sizing:content] hover:bg-sunken/70 focus:bg-sunken"
      />
      {!embedded && detail.trim() !== idea.title.trim() && (
        <p className="relative mt-1.5 line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-ink-soft">
          {detail}
        </p>
      )}

      {idea.nextStep && !embedded && (
        <p className="relative mt-4 flex items-start gap-2.5 rounded-field bg-accent-soft/60 px-3.5 py-2.5 text-sm leading-snug text-ink">
          <FootprintsIcon size={17} weight="bold" className="mt-0.5 shrink-0 text-accent-ink" aria-hidden />
          <span>
            <span className="font-medium">{m.suggestion.startWith} </span>
            {idea.nextStep}
          </span>
        </p>
      )}

      <div className="relative mt-5">
        <p id={`choices-${idea.id}`} className="mb-2.5 text-[13px] font-medium text-ink-soft">
          {m.suggestion.fileItIn}
        </p>
        <div role="radiogroup" aria-labelledby={`choices-${idea.id}`} className="flex flex-wrap gap-2">
          {options.map((choice, i) => {
            const active = picked !== null && choiceKey(choice) === choiceKey(picked);
            const isPrimary = i === 0;
            return (
              <button
                key={choiceKey(choice)}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPicked(choice)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border text-sm font-medium transition-all duration-200 active:scale-[0.98]",
                  isPrimary ? "h-11 pl-1.5 pr-4" : "h-9 pl-1 pr-3.5",
                  active
                    ? "border-accent-ink/50 bg-accent-soft text-ink"
                    : "border-line bg-panel text-ink-soft hover:border-line-strong hover:text-ink",
                )}
              >
                <span
                  className={cn(
                    "flex items-center justify-center rounded-full",
                    isPrimary ? "h-8 w-8" : "h-7 w-7",
                    active ? "bg-accent text-on-accent" : "bg-sunken",
                  )}
                >
                  <FolderGlyph name={choice.icon} size={isPrimary ? 16 : 14} weight={active ? "fill" : "regular"} />
                </span>
                <span className="max-w-[16ch] truncate">{choice.name}</span>
                {choice.kind === "new" && (
                  <span className="rounded-full bg-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                    {m.suggestion.newBadge}
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="inline-flex h-9 items-center rounded-full border border-dashed border-line-strong px-3.5 text-sm font-medium text-ink-soft transition hover:border-ink-faint hover:text-ink"
          >
            {m.suggestion.otherFolder}
          </button>
        </div>
      </div>

      <div className="relative mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <span className="hidden items-center gap-1.5 text-xs text-ink-faint sm:flex">
          {rich(m.suggestion.fileHint, { mod: <Kbd>{modKey}</Kbd>, enter: <Kbd>Enter</Kbd> })}
        </span>
        <div className="flex items-center gap-2 sm:ml-auto">
          {picked && <span className="sr-only">{fmt(m.suggestion.selectedFolder, { name: picked.name })}</span>}
          <Button variant="primary" onClick={file} disabled={!picked || busy}>
            {confirm.isPending ? (
              m.suggestion.filing
            ) : (
              <>
                {picked && <ChoiceCheck />}
                {m.suggestion.fileIdea}
              </>
            )}
          </Button>
        </div>
      </div>

      <FolderPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        folders={folders}
        onPick={pickCustom}
      />
    </motion.section>
  );
}

export function SuggestionSkeleton() {
  const { m } = useI18n();
  return (
    <div className="relative overflow-hidden rounded-card border border-accent-ink/30 bg-panel p-5 md:p-6" aria-live="polite">
      <span className="sr-only">{m.suggestion.finding}</span>
      <div aria-hidden>
        <div className="flex items-center gap-2 text-xs font-medium text-accent-ink">
          <SparkleIcon size={13} weight="fill" className="animate-pulse" />
          {m.suggestion.finding}
        </div>
        <div className="shimmer mt-4 h-6 w-2/3 rounded-md" />
        <div className="shimmer mt-3 h-3.5 w-full rounded-md" />
        <div className="shimmer mt-2 h-3.5 w-4/5 rounded-md" />
        <div className="mt-6 flex gap-2">
          <div className="shimmer h-11 w-40 rounded-full" />
          <div className="shimmer h-9 w-28 rounded-full" />
          <div className="shimmer h-9 w-24 rounded-full" />
        </div>
      </div>
    </div>
  );
}
