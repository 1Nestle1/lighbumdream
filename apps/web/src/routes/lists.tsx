import { useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { useNavigate, useParams } from "react-router";
import {
  ArchiveIcon,
  CheckCircleIcon,
  FolderSimpleDashedIcon,
  PencilSimpleIcon,
  StackIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useI18n } from "../i18n";
import { useDeleteFolder, useFolders, useIdeas } from "../lib/queries";
import { FolderGlyph } from "../components/FolderIcon";
import { FolderDialog } from "../components/FolderDialogs";
import { EmptyState, IdeaGrid } from "../components/IdeaGrid";
import { SuggestionCard, SuggestionSkeleton } from "../components/SuggestionCard";
import { useToast } from "../components/Toaster";
import { Button, Dialog, DialogHeader } from "../components/ui";

function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-tighter md:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-[60ch] text-base leading-relaxed text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function InboxPage() {
  const { m, errorText } = useI18n();
  const inbox = useIdeas("inbox");
  const folders = useFolders();
  const ideas = inbox.data?.pages.flatMap((p) => p.ideas) ?? [];

  return (
    <div>
      <PageHeader title={m.inboxPage.title} subtitle={m.inboxPage.subtitle} />
      {inbox.isPending ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <SuggestionSkeleton />
          <SuggestionSkeleton />
        </div>
      ) : inbox.isError ? (
        <p className="text-danger">{errorText(inbox.error)}</p>
      ) : ideas.length === 0 ? (
        <EmptyState
          icon={<CheckCircleIcon size={26} weight="duotone" />}
          title={m.inboxPage.zeroTitle}
          body={m.inboxPage.zeroBody}
        />
      ) : (
        <>
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <AnimatePresence initial={false} mode="popLayout">
              {ideas.map((idea) => (
                <SuggestionCard key={idea.id} idea={idea} folders={folders.data?.folders ?? []} />
              ))}
            </AnimatePresence>
          </div>
          {inbox.hasNextPage && (
            <div className="mt-6 flex justify-center">
              <Button onClick={() => inbox.fetchNextPage()} disabled={inbox.isFetchingNextPage}>
                {inbox.isFetchingNextPage ? m.common.loading : m.common.loadMore}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function AllIdeasPage() {
  const { m, plural } = useI18n();
  const counts = useFolders().data?.counts;
  return (
    <div>
      <PageHeader
        title={m.allPage.title}
        subtitle={counts ? plural(m.allPage.subtitle, counts.all) : undefined}
      />
      <IdeaGrid
        view="all"
        empty={
          <EmptyState
            icon={<StackIcon size={26} weight="duotone" />}
            title={m.allPage.emptyTitle}
            body={m.allPage.emptyBody}
          />
        }
      />
    </div>
  );
}

export function ArchivePage() {
  const { m } = useI18n();
  return (
    <div>
      <PageHeader title={m.archivePage.title} subtitle={m.archivePage.subtitle} />
      <IdeaGrid
        view="archive"
        empty={
          <EmptyState
            icon={<ArchiveIcon size={26} weight="duotone" />}
            title={m.archivePage.emptyTitle}
            body={m.archivePage.emptyBody}
          />
        }
      />
    </div>
  );
}

export function FolderPage() {
  const { m, fmt, plural, errorText } = useI18n();
  const { folderId = "" } = useParams();
  const folders = useFolders();
  const remove = useDeleteFolder();
  const toast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const folder = folders.data?.folders.find((f) => f.id === folderId);

  if (folders.isPending) {
    return (
      <div aria-hidden>
        <div className="shimmer h-16 w-72 rounded-card" />
      </div>
    );
  }
  if (!folder) {
    return (
      <EmptyState
        icon={<FolderSimpleDashedIcon size={26} weight="duotone" />}
        title={m.folderPage.notFoundTitle}
        body={m.folderPage.notFoundBody}
        action={<Button onClick={() => navigate("/")}>{m.folderPage.back}</Button>}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent text-on-accent shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
              <FolderGlyph name={folder.icon} size={28} weight="fill" />
            </span>
            <span className="min-w-0 truncate">{folder.name}</span>
          </span>
        }
        subtitle={plural(m.folderPage.count, folder.ideaCount)}
        actions={
          <>
            <Button size="sm" onClick={() => setEditing(true)}>
              <PencilSimpleIcon size={15} aria-hidden /> {m.common.edit}
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
              <TrashIcon size={15} aria-hidden /> {m.common.delete}
            </Button>
          </>
        }
      />
      <IdeaGrid
        view="all"
        folderId={folder.id}
        empty={
          <EmptyState
            icon={<FolderGlyph name={folder.icon} size={26} weight="duotone" />}
            title={m.folderPage.emptyTitle}
            body={m.folderPage.emptyBody}
          />
        }
      />

      <FolderDialog open={editing} onClose={() => setEditing(false)} folder={folder} />
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title={m.folderPage.deleteLabel}>
        <DialogHeader
          title={fmt(m.folderPage.deleteTitle, { name: folder.name })}
          onClose={() => setConfirmDelete(false)}
        />
        <div className="p-5 pt-3">
          <p className="text-sm leading-relaxed text-ink-soft">{plural(m.folderPage.deleteBody, folder.ideaCount)}</p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              {m.folderPage.keepFolder}
            </Button>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(folder.id, {
                  onSuccess: () => {
                    toast({ tone: "success", message: fmt(m.folderPage.deletedToast, { name: folder.name }) });
                    navigate("/inbox");
                  },
                  onError: (err) => toast({ tone: "error", message: errorText(err) }),
                })
              }
            >
              {m.folderPage.deleteFolder}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
