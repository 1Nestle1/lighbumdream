import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CaretLeftIcon,
  CaretRightIcon,
  DownloadSimpleIcon,
  FileIcon,
  FilePdfIcon,
  FileTextIcon,
  FileZipIcon,
  MicrophoneIcon,
  TrashIcon,
  XIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { IdeaFile, IdeaNote } from "@lightbulb/shared";
import { useI18n } from "../../i18n";
import { api } from "../../lib/api";
import type { useNotebookActions } from "../../lib/queries";
import { useToast } from "../Toaster";
import { Button, IconButton } from "../ui";

type Actions = ReturnType<typeof useNotebookActions>;

// ---------- Photos ----------

export function PhotoGrid({ photos, uploading, actions }: { photos: IdeaFile[]; uploading: number; actions: Actions }) {
  const { m, fmt } = useI18n();
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0 && uploading === 0) return null;

  return (
    <section aria-labelledby="photos-heading">
      <h2 id="photos-heading" className="mb-3 text-sm font-semibold tracking-tight">
        {m.ideaPage.photosTitle}
      </h2>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((photo, i) => (
          <motion.button
            key={photo.id}
            type="button"
            layout="position"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={() => setOpen(i)}
            aria-label={fmt(m.ideaPage.openPhoto, { name: photo.name })}
            className="group relative aspect-square overflow-hidden rounded-field bg-sunken focus-visible:outline-offset-2"
          >
            <img
              src={photo.url}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]"
            />
          </motion.button>
        ))}
        {Array.from({ length: uploading }, (_, i) => (
          <div key={`up-${i}`} className="shimmer aspect-square rounded-field" aria-hidden />
        ))}
      </div>
      <AnimatePresence>
        {open !== null && photos[open] && (
          <Lightbox photos={photos} index={open} onIndex={setOpen} onClose={() => setOpen(null)} actions={actions} />
        )}
      </AnimatePresence>
    </section>
  );
}

function Lightbox({
  photos,
  index,
  onIndex,
  onClose,
  actions,
}: {
  photos: IdeaFile[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  actions: Actions;
}) {
  const { m, fileSize, errorText } = useI18n();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const photo = photos[index]!;
  const step = (delta: number) => {
    setConfirming(false);
    onIndex((index + delta + photos.length) % photos.length);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const remove = () =>
    actions.deleteFile.mutate(photo.id, {
      onSuccess: () => (photos.length > 1 ? onIndex(Math.min(index, photos.length - 2)) : onClose()),
      onError: (err) => toast({ tone: "error", message: errorText(err) }),
    });

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={photo.name}
      className="fixed inset-0 z-50 flex flex-col bg-[oklch(0.12_0.01_262/0.94)] backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-[oklch(0.95_0.005_260)]">
        <p className="min-w-0 truncate text-sm">
          {photo.name} <span className="ml-2 font-mono text-xs opacity-60">{fileSize(photo.sizeBytes)}</span>
        </p>
        <div className="flex items-center gap-1">
          <a
            href={photo.url}
            download={photo.name}
            aria-label={m.ideaPage.download}
            title={m.ideaPage.download}
            className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10"
          >
            <DownloadSimpleIcon size={19} />
          </a>
          {confirming ? (
            <Button size="sm" variant="danger" className="bg-panel" onClick={remove} disabled={actions.deleteFile.isPending}>
              {m.ideaPage.deletePhoto}
            </Button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label={m.ideaPage.deletePhoto}
              title={m.ideaPage.deletePhoto}
              className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10"
            >
              <TrashIcon size={19} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={m.common.close}
            className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10"
          >
            <XIcon size={19} />
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6" onClick={onClose}>
        <AnimatePresence mode="wait">
          <motion.img
            key={photo.id}
            src={photo.url}
            alt={photo.name}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-field object-contain shadow-float"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
          />
        </AnimatePresence>
        {photos.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                step(-1);
              }}
              aria-label={m.ideaPage.prevPhoto}
              className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <CaretLeftIcon size={20} weight="bold" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                step(1);
              }}
              aria-label={m.ideaPage.nextPhoto}
              className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <CaretRightIcon size={20} weight="bold" />
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}

// ---------- Notes and files ----------

const fileIcon = (mime: string): Icon =>
  mime === "application/pdf"
    ? FilePdfIcon
    : mime === "application/zip"
      ? FileZipIcon
      : mime.startsWith("text/")
        ? FileTextIcon
        : FileIcon;

type Entry = { kind: "note"; at: string; note: IdeaNote } | { kind: "file"; at: string; file: IdeaFile };

/** Everything added to the idea over time, newest first. */
export function Timeline({
  notes,
  files,
  uploading,
  actions,
}: {
  notes: IdeaNote[];
  files: IdeaFile[];
  uploading: number;
  actions: Actions;
}) {
  const { m, timeAgo, fullDate, fileSize, errorText } = useI18n();
  const toast = useToast();
  const onError = (err: Error) => toast({ tone: "error", message: errorText(err) });

  const entries: Entry[] = [
    ...notes.map((note): Entry => ({ kind: "note", at: note.createdAt, note })),
    ...files.map((file): Entry => ({ kind: "file", at: file.createdAt, file })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section aria-labelledby="timeline-heading">
      <h2 id="timeline-heading" className="mb-3 text-sm font-semibold tracking-tight">
        {m.ideaPage.timelineTitle}
      </h2>
      {entries.length === 0 && uploading === 0 ? (
        <p className="rounded-field border border-dashed border-line-strong px-4 py-5 text-[13px] leading-relaxed text-ink-faint">
          {m.ideaPage.timelineEmpty}
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {Array.from({ length: uploading }, (_, i) => (
            <li key={`up-${i}`} className="shimmer h-14 rounded-field" aria-hidden />
          ))}
          <AnimatePresence initial={false}>
            {entries.map((entry) => (
              <motion.li
                key={entry.kind === "note" ? entry.note.id : entry.file.id}
                layout="position"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
                className="group relative rounded-field border border-line bg-panel px-3.5 py-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <time dateTime={entry.at} title={fullDate(entry.at)} className="font-mono text-[11px] text-ink-faint">
                    {timeAgo(entry.at)}
                  </time>
                  <IconButton
                    label={entry.kind === "note" ? m.ideaPage.deleteNote : m.ideaPage.deleteFile}
                    size="sm"
                    className="!h-7 !w-7 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() =>
                      entry.kind === "note"
                        ? actions.deleteNote.mutate(entry.note.id, { onError })
                        : actions.deleteFile.mutate(entry.file.id, { onError })
                    }
                  >
                    <TrashIcon size={14} />
                  </IconButton>
                </div>
                {entry.kind === "note" ? (
                  <>
                    <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-ink">{entry.note.text}</p>
                    {entry.note.hasAudio && (
                      <div className="mt-2.5 flex items-center gap-2">
                        <MicrophoneIcon size={14} className="shrink-0 text-accent-ink" aria-hidden />
                        <audio
                          controls
                          preload="none"
                          src={api.noteAudioUrl(entry.note.id)}
                          aria-label={m.ideaPage.voiceNote}
                          className="h-8 w-full"
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <FileRow file={entry.file} size={fileSize(entry.file.sizeBytes)} downloadLabel={m.ideaPage.download} />
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
    </section>
  );
}

function FileRow({ file, size, downloadLabel }: { file: IdeaFile; size: string; downloadLabel: string }) {
  const Glyph = fileIcon(file.mime);
  return (
    <a
      href={file.url}
      download={file.name}
      title={downloadLabel}
      className="mt-1.5 flex items-center gap-3 rounded-[10px] transition hover:text-accent-ink"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-sunken text-ink-soft">
        <Glyph size={18} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{file.name}</span>
        <span className="block font-mono text-[11px] text-ink-faint">{size}</span>
      </span>
      <DownloadSimpleIcon size={17} className="shrink-0 text-ink-faint" aria-hidden />
    </a>
  );
}
