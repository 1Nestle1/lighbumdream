import { useRef, useState } from "react";
import { PaperclipIcon } from "@phosphor-icons/react";
import { LIMITS } from "@lightbulb/shared/constants";
import { useI18n } from "../../i18n";
import { cn, modKey } from "../../lib/format";
import type { useNotebookActions } from "../../lib/queries";
import { useToast } from "../Toaster";
import { Button, IconButton, Kbd } from "../ui";
import { MicButton, VoiceStatus, useVoiceInput } from "../Voice";

type Actions = ReturnType<typeof useNotebookActions>;

export const ACCEPTED_FILES =
  "image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,.heic,.pdf,.txt,.md,.csv,.json,.zip,.doc,.docx,.xls,.xlsx,.pptx";

/** Uploads one file at a time; too-large files are refused before they leave the browser. */
export function useUploads(actions: Actions) {
  const { m, fmt, errorText } = useI18n();
  const toast = useToast();
  const [pending, setPending] = useState(0);

  const upload = async (files: File[]) => {
    const ok = files.filter((file) => {
      if (file.size <= LIMITS.fileBytes) return true;
      toast({ tone: "error", message: fmt(m.ideaPage.fileTooBig, { name: file.name }) });
      return false;
    });
    setPending((n) => n + ok.length);
    for (const file of ok) {
      try {
        await actions.uploadFile.mutateAsync(file);
      } catch (err) {
        toast({ tone: "error", message: errorText(err) });
      } finally {
        setPending((n) => n - 1);
      }
    }
  };

  return { upload, pending };
}

/** The only way to add to an idea: a short note (typed or spoken), photos and files. */
export function AddPanel({ actions, upload }: { actions: Actions; upload: (files: File[]) => void }) {
  const { m, rich, errorText } = useI18n();
  const toast = useToast();
  const [text, setText] = useState("");
  const [clipId, setClipId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const voice = useVoiceInput((heard, id) => {
    setText((prev) => (prev.trim() ? `${prev.trim()} ${heard}` : heard).slice(0, LIMITS.noteChars));
    setClipId(id);
  });

  const busy = actions.addNote.isPending || voice.busy;
  const add = () => {
    const value = text.trim();
    if (!value || busy) return;
    actions.addNote.mutate(
      { text: value, clipId: clipId ?? undefined },
      {
        onSuccess: () => {
          setText("");
          setClipId(null);
          toast({ tone: "success", message: m.ideaPage.noteAdded });
        },
        onError: (err) => toast({ tone: "error", message: errorText(err) }),
      },
    );
  };

  const nearLimit = text.length > LIMITS.noteChars * 0.8;

  return (
    <section
      ref={voice.levelRef}
      aria-labelledby="add-heading"
      className="rounded-card border border-line bg-panel p-4 shadow-card md:p-5"
    >
      <h2 id="add-heading" className="text-sm font-semibold tracking-tight">
        {m.ideaPage.addTitle}
      </h2>
      <label htmlFor="note-input" className="sr-only">
        {m.ideaPage.noteLabel}
      </label>
      <textarea
        id="note-input"
        value={text}
        rows={3}
        maxLength={LIMITS.noteChars}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value.trim()) setClipId(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            add();
          }
        }}
        // Pasting a screenshot attaches it straight away.
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            upload(files);
          }
        }}
        placeholder={m.ideaPage.notePlaceholder}
        className="mt-3 block max-h-60 min-h-[5.5rem] w-full resize-none rounded-field border border-line bg-sunken/50 px-3.5 py-3 text-[15px] leading-relaxed text-ink outline-none transition [field-sizing:content] placeholder:text-ink-faint focus:border-accent-ink focus:bg-panel focus:ring-4 focus:ring-accent/25"
      />
      <VoiceStatus voice={voice} />
      <div className="mt-3 flex items-center gap-2">
        <MicButton voice={voice} />
        <IconButton label={m.ideaPage.attach} variant="secondary" onClick={() => fileInput.current?.click()}>
          <PaperclipIcon size={18} />
        </IconButton>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPTED_FILES}
          className="hidden"
          onChange={(e) => {
            upload(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <span className={cn("min-w-0 flex-1 truncate text-xs", nearLimit ? "font-mono text-ink-soft" : "text-ink-faint")}>
          {nearLimit ? `${text.length}/${LIMITS.noteChars}` : m.ideaPage.attachHint}
        </span>
        <Button variant="primary" size="sm" onClick={add} disabled={!text.trim() || busy}>
          {m.ideaPage.add}
        </Button>
      </div>
      <p className="mt-2 hidden items-center gap-1 text-[11px] text-ink-faint md:flex">
        {rich(m.ideaPage.addHint, { mod: <Kbd>{modKey}</Kbd>, enter: <Kbd>Enter</Kbd> })}
      </p>
    </section>
  );
}
