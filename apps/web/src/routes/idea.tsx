import { useEffect, useRef, useState, type DragEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  CaretDownIcon,
  FolderSimpleDashedIcon,
  MicrophoneIcon,
  RobotIcon,
  StarIcon,
  TrashIcon,
  TrayArrowDownIcon,
} from "@phosphor-icons/react";
import type { Idea } from "@lightbulb/shared";
import { LIMITS } from "@lightbulb/shared/constants";
import { useI18n } from "../i18n";
import { ApiError, api } from "../lib/api";
import { cn } from "../lib/format";
import {
  useDeleteIdea,
  useFavorite,
  useFolders,
  useIdea,
  useNotebook,
  useNotebookActions,
  useUpdateIdea,
} from "../lib/queries";
import { AddPanel, useUploads } from "../components/idea/AddPanel";
import { AgentSection } from "../components/idea/Agent";
import { PhotoGrid, Timeline } from "../components/idea/Media";
import { NextStepCard, StepsSection } from "../components/idea/Steps";
import { FolderGlyph } from "../components/FolderIcon";
import { EmptyState } from "../components/IdeaGrid";
import { SuggestionCard } from "../components/SuggestionCard";
import { useToast } from "../components/Toaster";
import { Button, IconButton } from "../components/ui";

/**
 * An idea's page. Deliberately restricted: next step, a capped checklist, a short
 * description, and short notes, photos and files. No free-form document.
 */
export function IdeaPage() {
  const { m, errorText } = useI18n();
  const navigate = useNavigate();
  const { ideaId = "" } = useParams();
  const idea = useIdea(ideaId);

  if (idea.isPending) return <IdeaPageSkeleton />;
  if (idea.isError || !idea.data) {
    const missing = idea.error instanceof ApiError && (idea.error.status === 404 || idea.error.status === 400);
    return (
      <EmptyState
        icon={<FolderSimpleDashedIcon size={26} weight="duotone" />}
        title={m.ideaPage.notFoundTitle}
        body={missing ? m.ideaPage.notFoundBody : errorText(idea.error)}
        action={<Button onClick={() => navigate("/")}>{m.folderPage.back}</Button>}
      />
    );
  }
  return <IdeaWorkspace key={idea.data.id} idea={idea.data} />;
}

function IdeaWorkspace({ idea }: { idea: Idea }) {
  const { m } = useI18n();
  const folders = useFolders();
  const notebook = useNotebook(idea.id);
  const actions = useNotebookActions(idea.id);
  const { upload, pending } = useUploads(actions);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const folderList = folders.data?.folders ?? [];
  const data = notebook.data;
  const photos = data?.files.filter((f) => f.kind === "image") ?? [];
  const otherFiles = data?.files.filter((f) => f.kind === "file") ?? [];

  // Files can be dropped anywhere on the page. The depth counter ignores
  // enter/leave events from child elements so the overlay doesn't flicker.
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: (e: DragEvent) => hasFiles(e) && e.preventDefault(),
    onDragLeave: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      void upload(Array.from(e.dataTransfer.files));
    },
  };

  return (
    <div {...dropHandlers} className="flex flex-col gap-8">
      <IdeaHeader idea={idea} />

      {idea.status === "inbox" && !idea.archivedAt && idea.suggestion && (
        <section aria-label={m.ideaPage.waiting}>
          <SuggestionCard idea={idea} folders={folderList} />
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-10">
          {data ? (
            <>
              <NextStepCard steps={data.steps} actions={actions} />
              <AgentSection ideaId={idea.id} projectPath={idea.projectPath} notebook={actions} />
              <StepsSection steps={data.steps} actions={actions} />
            </>
          ) : (
            <div className="shimmer h-56 rounded-card" aria-hidden />
          )}
          <DescriptionSection idea={idea} />
        </div>

        <aside className="flex min-w-0 flex-col gap-8">
          <AddPanel actions={actions} upload={(files) => void upload(files)} />
          {data ? (
            <>
              <PhotoGrid photos={photos} uploading={0} actions={actions} />
              <Timeline notes={data.notes} files={otherFiles} uploading={pending} actions={actions} />
            </>
          ) : (
            <div className="space-y-2" aria-hidden>
              <div className="shimmer h-16 rounded-field" />
              <div className="shimmer h-16 rounded-field" />
            </div>
          )}
        </aside>
      </div>

      <AnimatePresence>
        {dragging && (
          <motion.div
            className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-canvas/75 p-6 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-card border-2 border-dashed border-accent-ink/60 bg-panel px-8 py-12 text-center shadow-float">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-on-accent">
                <TrayArrowDownIcon size={28} weight="bold" aria-hidden />
              </span>
              <p className="text-lg font-semibold tracking-tight">{m.ideaPage.dropHere}</p>
              <p className="text-sm text-ink-soft">{m.ideaPage.attachHint}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function IdeaHeader({ idea }: { idea: Idea }) {
  const { m, fmt, fullDate, timeAgo, errorText } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const folders = useFolders();
  const update = useUpdateIdea();
  const remove = useDeleteIdea();
  const [title, setTitle] = useState(idea.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setTitle(idea.title), [idea.title]);

  const folderList = folders.data?.folders ?? [];
  const folder = folderList.find((f) => f.id === idea.folderId);
  const archived = Boolean(idea.archivedAt);
  const onError = (err: Error) => toast({ tone: "error", message: errorText(err) });

  const saveTitle = () => {
    const value = title.trim();
    if (value && value !== idea.title) update.mutate({ id: idea.id, body: { title: value } }, { onError });
    else setTitle(idea.title);
  };

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to={folder ? `/folders/${folder.id}` : "/inbox"}
          className="inline-flex items-center gap-1.5 rounded-full py-1 pr-2 text-sm font-medium text-ink-soft transition hover:text-ink"
        >
          <ArrowLeftIcon size={15} weight="bold" aria-hidden />
          {folder ? folder.name : m.nav.inbox}
        </Link>
        <div className="flex items-center gap-2">
          <FavoriteButton idea={idea} />
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
              document.getElementById("agent")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
            }}
          >
            <RobotIcon size={15} weight="bold" aria-hidden />
            {m.agent.title}
          </Button>
          <Button
            size="sm"
            onClick={() =>
              update.mutate(
                { id: idea.id, body: { archived: !archived } },
                {
                  onSuccess: () => toast({ tone: "success", message: archived ? m.ideaPage.restored : m.ideaPage.archived }),
                  onError,
                },
              )
            }
          >
            {archived ? (
              <ArrowCounterClockwiseIcon size={15} aria-hidden />
            ) : (
              <ArchiveIcon size={15} aria-hidden />
            )}
            {archived ? m.ideaPage.restore : m.ideaPage.archive}
          </Button>
          {confirmDelete ? (
            <>
              <span className="hidden text-[13px] text-ink-soft sm:inline">{m.ideaPage.deleteConfirm}</span>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                {m.common.keep}
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(idea.id, {
                    onSuccess: () => {
                      toast({ tone: "success", message: m.ideaPage.deleted });
                      navigate(folder ? `/folders/${folder.id}` : "/");
                    },
                    onError,
                  })
                }
              >
                {m.common.delete}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
              <TrashIcon size={15} aria-hidden /> {m.common.delete}
            </Button>
          )}
        </div>
      </div>

      <label htmlFor="idea-title" className="sr-only">
        {m.ideaPage.titleLabel}
      </label>
      <textarea
        id="idea-title"
        value={title}
        rows={1}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
        onBlur={saveTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setTitle(idea.title);
            e.currentTarget.blur();
          }
        }}
        className="-mx-2 block w-[calc(100%+1rem)] resize-none rounded-field bg-transparent px-2 py-1 text-3xl font-semibold leading-[1.15] tracking-tighter text-ink outline-none transition [field-sizing:content] hover:bg-sunken/60 focus:bg-sunken md:text-[2.5rem]"
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-ink-soft">
        {/* Moving between folders; "Inbox" sends it back to be filed. */}
        {idea.status === "filed" && (
          <label className="relative inline-flex items-center">
            <span className="sr-only">{m.ideaPage.folder}</span>
            <span className="pointer-events-none absolute left-2.5 text-ink-soft">
              {folder ? <FolderGlyph name={folder.icon} size={14} weight="bold" /> : null}
            </span>
            <select
              value={idea.folderId ?? ""}
              onChange={(e) => update.mutate({ id: idea.id, body: { folderId: e.target.value || null } }, { onError })}
              className={cn(
                "h-8 appearance-none rounded-full border border-line bg-panel pr-8 text-[13px] font-medium text-ink outline-none transition hover:border-line-strong focus:border-accent-ink",
                folder ? "pl-8" : "pl-3",
              )}
            >
              <option value="">{m.ideaPage.noFolder}</option>
              {folderList.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <CaretDownIcon size={12} weight="bold" className="pointer-events-none absolute right-3 text-ink-faint" aria-hidden />
          </label>
        )}
        {archived && (
          <span className="rounded-full bg-sunken px-2.5 py-1 font-medium text-ink-soft">{m.ideaPage.archivedBadge}</span>
        )}
        <span title={fullDate(idea.createdAt)}>
          {fmt(m.ideaPage.captured, { date: fullDate(idea.createdAt) })}, {fmt(m.ideaPage.touched, { ago: timeAgo(idea.updatedAt) })}
        </span>
        {idea.hasAudio && <MicrophoneIcon size={14} aria-label={m.card.voice} />}
      </div>
    </header>
  );
}

/** Stars the idea as a favourite project, so it stays on top of the projects board. */
function FavoriteButton({ idea }: { idea: Idea }) {
  const { m, errorText } = useI18n();
  const toast = useToast();
  const favorite = useFavorite();
  const starred = Boolean(idea.favoriteAt);
  return (
    <IconButton
      size="sm"
      variant="secondary"
      label={starred ? m.projects.unstar : m.projects.star}
      aria-pressed={starred}
      onClick={() =>
        favorite.mutate(
          { ideaId: idea.id, favorite: !starred },
          { onError: (err) => toast({ tone: "error", message: errorText(err) }) },
        )
      }
      className={starred ? "text-accent-ink" : undefined}
    >
      <StarIcon size={16} weight={starred ? "fill" : "regular"} />
    </IconButton>
  );
}

function DescriptionSection({ idea }: { idea: Idea }) {
  const { m, errorText } = useI18n();
  const toast = useToast();
  const update = useUpdateIdea();
  const [body, setBody] = useState(idea.body);
  useEffect(() => setBody(idea.body), [idea.body]);
  const dirty = body.trim() !== idea.body && body.trim().length > 0;

  const save = () =>
    update.mutate(
      { id: idea.id, body: { body: body.trim() } },
      {
        onSuccess: () => toast({ tone: "success", message: m.ideaPage.saved }),
        onError: (err) => toast({ tone: "error", message: errorText(err) }),
      },
    );

  return (
    <section aria-labelledby="description-heading">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="description-heading" className="text-lg font-semibold tracking-tight">
          {m.ideaPage.descriptionTitle}
        </h2>
        <span className="font-mono text-xs text-ink-faint">
          {body.length}/{LIMITS.bodyChars}
        </span>
      </div>
      <label htmlFor="idea-body" className="sr-only">
        {m.ideaPage.descriptionTitle}
      </label>
      <textarea
        id="idea-body"
        value={body}
        maxLength={LIMITS.bodyChars}
        rows={4}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && dirty) {
            e.preventDefault();
            save();
          }
        }}
        aria-describedby="description-hint"
        className="block min-h-28 w-full resize-none rounded-field border border-line bg-panel px-4 py-3.5 text-[15px] leading-relaxed text-ink outline-none transition [field-sizing:content] focus:border-accent-ink focus:ring-4 focus:ring-accent/25"
      />
      <div className="mt-2 flex min-h-8 items-center justify-between gap-3">
        <p id="description-hint" className="text-[13px] text-ink-faint">
          {m.ideaPage.descriptionHint}
        </p>
        {dirty && (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setBody(idea.body)}>
              {m.ideaPage.discard}
            </Button>
            <Button size="sm" variant="primary" onClick={save} disabled={update.isPending}>
              {update.isPending ? m.common.saving : m.common.save}
            </Button>
          </div>
        )}
      </div>
      {idea.hasAudio && (
        <div className="mt-3 flex items-center gap-2 rounded-field bg-sunken/60 px-3 py-2">
          <MicrophoneIcon size={15} className="shrink-0 text-accent-ink" aria-hidden />
          <audio controls preload="none" src={api.audioUrl(idea.id)} aria-label={m.ideaPage.recording} className="h-8 w-full" />
        </div>
      )}
    </section>
  );
}

function IdeaPageSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <div className="shimmer h-5 w-32 rounded-full" />
      <div className="shimmer h-11 w-2/3 rounded-md" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="shimmer h-64 rounded-card" />
        <div className="shimmer h-48 rounded-card" />
      </div>
    </div>
  );
}
