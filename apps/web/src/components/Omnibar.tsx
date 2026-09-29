import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { useNavigate } from "react-router";
import {
  ArchiveIcon,
  ArrowBendDownLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  LightbulbFilamentIcon,
  PlusIcon,
  RepeatIcon,
  SquaresFourIcon,
  StackIcon,
  TrayIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { Idea, RelatedIdea } from "@lightbulb/shared";
import { LIMITS } from "@lightbulb/shared/constants";
import { useI18n } from "../i18n";
import { cn, modKey } from "../lib/format";
import { useAddNoteTo, useCreateIdea, useFolders, useRelated } from "../lib/queries";
import { FolderGlyph } from "./FolderIcon";
import { FolderChip, Highlighted } from "./IdeaCard";
import { useOpenIdea } from "./IdeaGrid";
import { useToast } from "./Toaster";
import { Button, IconButton, Kbd } from "./ui";
import { MicButton, VoiceStatus, useVoiceInput } from "./Voice";

// ---------- Global access: Ctrl/⌘ K or "/" from anywhere ----------

interface OmnibarContextValue {
  open: () => void;
  /** The bank page's inline bar registers here, so the shortcut focuses it instead of opening an overlay. */
  registerInline: (focus: (() => void) | null) => void;
}

const OmnibarContext = createContext<OmnibarContextValue>({ open: () => {}, registerInline: () => {} });
export const useOmnibar = () => useContext(OmnibarContext);

export function OmnibarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const inline = useRef<(() => void) | null>(null);

  const summon = useCallback(() => {
    if (inline.current) inline.current();
    else setOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]");
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (open) setOpen(false);
        else summon();
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        summon();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, summon]);

  const value = useRef<OmnibarContextValue>({
    open: () => summon(),
    registerInline: (focus) => {
      inline.current = focus;
    },
  }).current;

  return (
    <OmnibarContext.Provider value={value}>
      {children}
      <AnimatePresence>{open && <OmnibarOverlay onClose={() => setOpen(false)} />}</AnimatePresence>
    </OmnibarContext.Provider>
  );
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// ---------- The bar ----------

/**
 * One bar for everything: type or say an idea to capture it, and while you type it
 * shows what's already in your bank so you add to an old idea instead of starting over.
 */
function useOmnibarState({ onSaved }: { onSaved: (idea: Idea) => void }) {
  const [text, setText] = useState("");
  const [clipId, setClipId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const create = useCreateIdea();
  const addNote = useAddNoteTo();

  const voice = useVoiceInput((heard, id) => {
    setText((prev) => (prev.trim() ? `${prev.trim()} ${heard}` : heard));
    setClipId(id);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    });
  });

  // The recording only belongs to this text while there is some.
  useEffect(() => {
    if (!text.trim()) setClipId(null);
  }, [text]);

  const busy = create.isPending || addNote.isPending || voice.busy;
  const reset = () => {
    setText("");
    setClipId(null);
  };

  const save = () => {
    const value = text.trim();
    if (!value || busy) return;
    create.mutate(
      { text: value, clipId: clipId ?? undefined },
      {
        onSuccess: (idea) => {
          reset();
          onSaved(idea);
        },
      },
    );
  };

  /** Adds what's in the bar to an existing idea as a note, instead of creating a duplicate. */
  const addTo = (idea: Pick<Idea, "id" | "title">, onDone: () => void) => {
    const value = text.trim();
    if (!value || busy) return;
    addNote.mutate(
      { ideaId: idea.id, text: value.slice(0, LIMITS.noteChars), clipId: clipId ?? undefined },
      {
        onSuccess: () => {
          reset();
          onDone();
        },
      },
    );
  };

  const error = create.error ?? addNote.error;
  return { text, setText, clipId, textareaRef, voice, create, busy, error, save, addTo };
}

/** Toast after "Add to it", with a way to jump to the idea. */
function useAddedToast() {
  const { m, fmt } = useI18n();
  const toast = useToast();
  const openIdea = useOpenIdea();
  return (idea: Pick<Idea, "id" | "title">) =>
    toast({
      tone: "success",
      message: fmt(m.bar.addedTo, { title: idea.title }),
      action: { label: m.bar.open, onClick: () => openIdea(idea.id) },
    });
}

// ---------- Inline hero bar (bank page) ----------

export function OmnibarInline({
  onSaved,
  onPendingChange,
}: {
  onSaved: (idea: Idea) => void;
  onPendingChange?: (p: boolean) => void;
}) {
  const { m, rich, errorText } = useI18n();
  const bar = useOmnibarState({ onSaved });
  const { registerInline } = useOmnibar();
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const openIdea = useOpenIdea();
  const addedToast = useAddedToast();
  const debounced = useDebounced(bar.text.trim(), 250);
  const related = useRelated(debounced);
  const results = bar.text.trim() && debounced.length >= 2 ? (related.data?.ideas ?? []) : [];

  useEffect(() => onPendingChange?.(bar.create.isPending), [bar.create.isPending, onPendingChange]);

  useEffect(() => {
    registerInline(() => {
      containerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      bar.textareaRef.current?.focus();
    });
    return () => registerInline(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recording = bar.voice.recorder.state === "recording";
  const hasText = bar.text.trim().length > 0;
  const lit = bar.busy || recording ? 1 : focused ? (hasText ? 1 : 0.6) : hasText ? 0.4 : 0.1;

  return (
    <div ref={containerRef}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          bar.save();
        }}
        className="relative"
        style={{ "--lit": lit } as CSSProperties}
      >
        <div className="filament-glow" aria-hidden />
        <div className="filament" aria-hidden />
        <div
          ref={bar.voice.levelRef}
          className="relative rounded-[22px] border border-line bg-panel/95 p-4 shadow-float backdrop-blur-sm md:p-6"
        >
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="omnibar" className="flex items-center gap-2 text-[13px] font-medium text-ink-soft">
              <LightbulbFilamentIcon
                size={16}
                weight={lit > 0.5 ? "fill" : "regular"}
                className={cn("transition-colors", lit > 0.5 ? "text-accent-ink" : "text-ink-faint")}
                aria-hidden
              />
              {m.bar.label}
            </label>
            <span className="hidden items-center gap-1 text-xs text-ink-faint md:flex">
              {rich(m.bar.fromAnywhere, { mod: <Kbd>{modKey}</Kbd>, k: <Kbd>K</Kbd> })}
            </span>
          </div>
          <textarea
            ref={bar.textareaRef}
            id="omnibar"
            value={bar.text}
            onChange={(e) => bar.setText(e.target.value.slice(0, LIMITS.bodyChars))}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                bar.save();
              } else if (e.key === "Escape") {
                if (recording) bar.voice.recorder.cancel();
                else e.currentTarget.blur();
              }
            }}
            rows={2}
            placeholder={m.bar.placeholder}
            className="mt-2.5 block max-h-72 min-h-[4rem] w-full resize-none bg-transparent text-xl leading-relaxed text-ink outline-none [field-sizing:content] placeholder:text-ink-faint/80 md:text-2xl md:leading-snug"
          />
          <VoiceStatus voice={bar.voice} />
          {bar.error && (
            <p className="mt-2 text-[13px] text-danger" role="alert">
              {errorText(bar.error)}
            </p>
          )}
          <div className="mt-4 flex items-center gap-3">
            <MicButton voice={bar.voice} size="lg" />
            <p className="hidden flex-1 items-center gap-1.5 text-xs text-ink-faint sm:flex">
              {bar.clipId
                ? m.bar.recordingAttached
                : rich(m.bar.enterHint, { enter: <Kbd>Enter</Kbd>, shift: <Kbd>Shift</Kbd> })}
            </p>
            <Button type="submit" variant="primary" size="lg" className="ml-auto" disabled={!hasText || bar.busy}>
              {bar.create.isPending ? m.common.saving : m.bar.save}
              {!bar.create.isPending && <ArrowUpIcon size={16} weight="bold" aria-hidden />}
            </Button>
          </div>
        </div>
      </form>

      <AnimatePresence>
        {results.length > 0 && (
          <RelatedPanel
            key="related"
            results={results}
            onOpen={(id) => openIdea(id)}
            onAddTo={(idea) => bar.addTo(idea, () => addedToast(idea))}
            adding={bar.busy}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function RelatedPanel({
  results,
  onOpen,
  onAddTo,
  adding,
}: {
  results: RelatedIdea[];
  onOpen: (id: string) => void;
  onAddTo: (idea: RelatedIdea) => void;
  adding: boolean;
}) {
  const { m, fmt } = useI18n();
  const folders = useFolders();
  const byId = new Map((folders.data?.folders ?? []).map((f) => [f.id, f]));
  const duplicate = results.find((r) => r.duplicate);

  return (
    <motion.section
      aria-label={m.bar.alreadyInBank}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 360, damping: 32 }}
      className="relative mx-2 -mt-px overflow-hidden rounded-b-card border border-t-0 border-line bg-panel/90 backdrop-blur-sm md:mx-4"
    >
      {duplicate && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-accent-soft/70 px-4 py-3">
          <RepeatIcon size={18} weight="bold" className="text-accent-ink" aria-hidden />
          <p className="min-w-0 flex-1 text-sm leading-snug text-ink">
            <strong className="block font-semibold">{m.bar.alreadyHave}</strong>
            <span className="text-ink-soft">{m.bar.addInstead}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => onOpen(duplicate.id)}>
              {m.bar.open}
            </Button>
            <Button size="sm" variant="primary" onClick={() => onAddTo(duplicate)} disabled={adding}>
              <PlusIcon size={14} weight="bold" aria-hidden /> {m.bar.addToIt}
            </Button>
          </div>
        </div>
      )}
      <p className="px-4 pb-1 pt-3 text-xs font-medium text-ink-faint">{m.bar.alreadyInBank}</p>
      <ul className="p-1.5 pt-0">
        {results.slice(0, 4).map((idea) => {
          const folder = idea.folderId ? byId.get(idea.folderId) : undefined;
          return (
            <li key={idea.id} className="group flex items-center gap-1 rounded-field transition hover:bg-sunken">
              <button
                type="button"
                onClick={() => onOpen(idea.id)}
                className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left"
              >
                <FolderChip folder={folder ? { name: folder.name, icon: folder.icon } : null} className="mt-0.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{idea.title}</span>
                  <span className="mt-0.5 line-clamp-1 block text-[13px] text-ink-soft">
                    {idea.nextStep ? (
                      fmt(m.bar.next, { step: idea.nextStep })
                    ) : idea.snippet ? (
                      <Highlighted text={idea.snippet} />
                    ) : (
                      idea.body
                    )}
                  </span>
                </span>
                <ArrowRightIcon
                  size={16}
                  className="mt-1 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </button>
              <IconButton
                label={fmt(m.bar.addToTitle, { title: idea.title })}
                size="sm"
                className="mr-1.5 shrink-0 opacity-70 group-hover:opacity-100"
                onClick={() => onAddTo(idea)}
                disabled={adding}
              >
                <PlusIcon size={15} weight="bold" />
              </IconButton>
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}

// ---------- Overlay (Ctrl/⌘ K anywhere else) ----------

interface Row {
  key: string;
  label: ReactNode;
  detail?: ReactNode;
  icon: ReactNode;
  hint?: ReactNode;
  run: () => void;
}

function OmnibarOverlay({ onClose }: { onClose: () => void }) {
  const { m, fmt, rich, errorText } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const openIdea = useOpenIdea();
  const addedToast = useAddedToast();
  const folders = useFolders();
  const byId = new Map((folders.data?.folders ?? []).map((f) => [f.id, f]));
  const [active, setActive] = useState(0);

  const bar = useOmnibarState({
    onSaved: (idea) => {
      onClose();
      toast({
        tone: "success",
        message: m.bar.savedToast,
        action: { label: m.bar.fileIt, onClick: () => openIdea(idea.id) },
      });
    },
  });

  useEffect(() => bar.textareaRef.current?.focus(), [bar.textareaRef]);

  const query = bar.text.trim();
  const debounced = useDebounced(query, 200);
  const related = useRelated(debounced);
  const results = query && debounced.length >= 2 ? (related.data?.ideas ?? []) : [];
  const duplicate = results.find((r) => r.duplicate);

  const go = (path: string) => () => {
    navigate(path);
    onClose();
  };

  const rows: Row[] = query
    ? [
        {
          key: "save",
          label: (
            <span className="truncate">
              {rich(m.bar.saveAsNew, {
                text: <span className="text-ink-soft">{query.length > 60 ? `${query.slice(0, 60)}...` : query}</span>,
              })}
            </span>
          ),
          icon: <LightbulbFilamentIcon size={18} weight="fill" className="text-accent-ink" />,
          hint: <Kbd>Enter</Kbd>,
          run: bar.save,
        },
        ...(duplicate
          ? [
              {
                key: "add-to-duplicate",
                label: <span className="truncate">{fmt(m.bar.addToTitle, { title: duplicate.title })}</span>,
                icon: <PlusIcon size={18} weight="bold" className="text-accent-ink" />,
                run: () =>
                  bar.addTo(duplicate, () => {
                    onClose();
                    addedToast(duplicate);
                  }),
              },
            ]
          : []),
        ...results.map((idea) => {
          const folder = idea.folderId ? byId.get(idea.folderId) : undefined;
          return {
            key: idea.id,
            label: (
              <span className="flex items-center gap-2">
                <span className="truncate">{idea.title}</span>
                {idea.duplicate && (
                  <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-ink">
                    {m.bar.sameIdea}
                  </span>
                )}
              </span>
            ),
            detail: idea.nextStep ? (
              fmt(m.bar.next, { step: idea.nextStep })
            ) : idea.snippet ? (
              <Highlighted text={idea.snippet} />
            ) : (
              idea.body
            ),
            icon: <FolderChip folder={folder ? { name: folder.name, icon: folder.icon } : null} className="!px-2" />,
            run: () => {
              openIdea(idea.id);
              onClose();
            },
          };
        }),
      ]
    : [
        { key: "bank", label: m.nav.bank, icon: <SquaresFourIcon size={18} />, run: go("/") },
        { key: "inbox", label: m.nav.inbox, icon: <TrayIcon size={18} />, run: go("/inbox") },
        { key: "all", label: m.nav.all, icon: <StackIcon size={18} />, run: go("/all") },
        { key: "archive", label: m.nav.archive, icon: <ArchiveIcon size={18} />, run: go("/archive") },
        ...(folders.data?.folders ?? []).map((f) => ({
          key: f.id,
          label: f.name,
          icon: <FolderGlyph name={f.icon} size={18} />,
          run: go(`/folders/${f.id}`),
        })),
      ];
  // Where the "already in your bank" results start in the list.
  const firstResult = duplicate ? 2 : 1;

  useEffect(() => setActive(0), [debounced, Boolean(query)]);

  const recording = bar.voice.recorder.state === "recording";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[9vh]">
      <motion.div
        className="absolute inset-0 bg-[oklch(0.15_0.02_262/0.45)] backdrop-blur-[3px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={m.bar.overlayLabel}
        className="relative w-full max-w-2xl overflow-hidden rounded-card border border-line bg-panel shadow-float"
        initial={{ opacity: 0, y: -10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
      >
        <div ref={bar.voice.levelRef} className="border-b border-line px-4 pb-3 pt-4">
          <div className="flex items-start gap-3">
            <label htmlFor="omnibar-overlay" className="sr-only">
              {m.bar.overlayInputLabel}
            </label>
            <textarea
              ref={bar.textareaRef}
              id="omnibar-overlay"
              value={bar.text}
              rows={1}
              onChange={(e) => bar.setText(e.target.value.slice(0, LIMITS.bodyChars))}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  if (recording) bar.voice.recorder.cancel();
                  else onClose();
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) => Math.min(i + 1, rows.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  rows[active]?.run();
                }
              }}
              placeholder={m.bar.overlayPlaceholder}
              className="max-h-40 min-h-[2.25rem] flex-1 resize-none bg-transparent py-1 text-lg leading-snug text-ink outline-none [field-sizing:content] placeholder:text-ink-faint"
              role="combobox"
              aria-expanded="true"
              aria-controls="omnibar-list"
              aria-activedescendant={rows[active] ? `omni-${rows[active].key}` : undefined}
            />
            <MicButton voice={bar.voice} />
            <button
              type="button"
              onClick={onClose}
              aria-label={m.common.close}
              className="mt-1 hidden h-8 w-8 items-center justify-center rounded-full text-ink-faint hover:bg-sunken hover:text-ink sm:flex"
            >
              <XIcon size={16} />
            </button>
          </div>
          <VoiceStatus voice={bar.voice} />
          {bar.error && (
            <p className="mt-2 text-[13px] text-danger" role="alert">
              {errorText(bar.error)}
            </p>
          )}
        </div>

        <ul id="omnibar-list" role="listbox" className="max-h-[55vh] overflow-y-auto p-2">
          {!query && (
            <li className="px-3 pb-1 pt-2 text-xs font-medium text-ink-faint" role="presentation">
              {m.bar.jumpTo}
            </li>
          )}
          {rows.map((row, i) => (
            <Fragment key={row.key}>
              {query && i === firstResult && (
                <li className="px-3 pb-1 pt-2 text-xs font-medium text-ink-faint" role="presentation">
                  {duplicate ? m.bar.mayHave : m.bar.alreadyInBank}
                </li>
              )}
              <li
                id={`omni-${row.key}`}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={row.run}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-field px-3 py-2.5",
                  i === active ? "bg-sunken" : "",
                )}
              >
                <span className={cn("mt-0.5 shrink-0", i === active ? "text-accent-ink" : "text-ink-soft")}>{row.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{row.label}</span>
                  {row.detail && (
                    <span className="mt-0.5 line-clamp-2 block text-[13px] leading-relaxed text-ink-soft">{row.detail}</span>
                  )}
                </span>
                {i === active &&
                  (row.hint ?? <ArrowBendDownLeftIcon size={16} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden />)}
              </li>
            </Fragment>
          ))}
        </ul>
      </motion.div>
    </div>
  );
}
