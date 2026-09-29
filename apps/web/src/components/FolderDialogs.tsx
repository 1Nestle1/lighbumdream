import { useEffect, useMemo, useState } from "react";
import { CheckIcon, MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import type { Folder, FolderChoice, FolderIcon } from "@lightbulb/shared";
import { FOLDER_ICONS } from "@lightbulb/shared/constants";
import { useI18n } from "../i18n";
import { cn } from "../lib/format";
import { useCreateFolder, useUpdateFolder } from "../lib/queries";
import { FolderGlyph } from "./FolderIcon";
import { Button, Dialog, DialogHeader, Field, inputClass } from "./ui";

export function IconPicker({
  value,
  onChange,
  id,
}: {
  value: FolderIcon;
  onChange: (icon: FolderIcon) => void;
  id?: string;
}) {
  const { m } = useI18n();
  return (
    <div id={id} role="radiogroup" aria-label={m.folderDialog.iconGroup} className="grid grid-cols-7 gap-1.5 sm:grid-cols-9">
      {FOLDER_ICONS.map((icon) => {
        const active = icon === value;
        return (
          <button
            key={icon}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={m.icons[icon]}
            onClick={() => onChange(icon)}
            className={cn(
              "flex aspect-square items-center justify-center rounded-[10px] border transition",
              active
                ? "border-accent-ink bg-accent-soft text-accent-ink"
                : "border-transparent text-ink-soft hover:bg-sunken hover:text-ink",
            )}
          >
            <FolderGlyph name={icon} size={18} weight={active ? "fill" : "regular"} />
          </button>
        );
      })}
    </div>
  );
}

/** Create or rename a folder. */
export function FolderDialog({
  open,
  onClose,
  folder,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  folder?: Folder;
  onSaved?: (folder: Folder) => void;
}) {
  const { m, errorText } = useI18n();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<FolderIcon>("Folder");
  const create = useCreateFolder();
  const update = useUpdateFolder();
  const mutation = folder ? update : create;

  useEffect(() => {
    if (!open) return;
    setName(folder?.name ?? "");
    setIcon(folder?.icon ?? "Folder");
    create.reset();
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, folder]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const saved = folder
      ? await update.mutateAsync({ id: folder.id, body: { name: trimmed, icon } })
      : await create.mutateAsync({ name: trimmed, icon });
    onSaved?.(saved);
    onClose();
  };

  const error = mutation.error ? errorText(mutation.error) || m.folderDialog.couldntSave : null;
  const title = folder ? m.folderDialog.editTitle : m.folderDialog.newTitle;

  return (
    <Dialog open={open} onClose={onClose} title={title} className="max-w-lg">
      <DialogHeader title={title} onClose={onClose} />
      <form onSubmit={(e) => void submit(e).catch(() => {})} className="flex flex-col gap-5 p-5">
        <Field label={m.folderDialog.name} htmlFor="folder-name" error={error}>
          <input
            id="folder-name"
            className={inputClass}
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder={m.folderDialog.namePlaceholder}
            autoComplete="off"
          />
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium text-ink-soft">{m.folderDialog.icon}</span>
          <IconPicker value={icon} onChange={setIcon} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {m.common.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || mutation.isPending}>
            {mutation.isPending ? m.common.saving : folder ? m.common.save : m.folderDialog.create}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Choose any existing folder, or name a new one. Returns a FolderChoice; nothing is saved here. */
export function FolderPickerDialog({
  open,
  onClose,
  folders,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  folders: Folder[];
  onPick: (choice: FolderChoice) => void;
}) {
  const { m, rich } = useI18n();
  const [query, setQuery] = useState("");
  const [newIcon, setNewIcon] = useState<FolderIcon>("Folder");

  useEffect(() => {
    if (open) {
      setQuery("");
      setNewIcon("Folder");
    }
  }, [open]);

  const trimmed = query.trim();
  const matches = useMemo(
    () => folders.filter((f) => f.name.toLowerCase().includes(trimmed.toLowerCase())),
    [folders, trimmed],
  );
  const exact = folders.some((f) => f.name.toLowerCase() === trimmed.toLowerCase());

  const pick = (choice: FolderChoice) => {
    onPick(choice);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={m.picker.title} className="max-w-lg">
      <DialogHeader title={m.picker.title} onClose={onClose} />
      <div className="p-5 pt-4">
        <Field label={m.picker.search} htmlFor="folder-search">
          <div className="relative">
            <MagnifyingGlassIcon
              size={16}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
              aria-hidden
            />
            <input
              id="folder-search"
              className={cn(inputClass, "pl-10")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={m.picker.placeholder}
              autoComplete="off"
              maxLength={60}
            />
          </div>
        </Field>

        <ul className="mt-4 max-h-64 space-y-1 overflow-y-auto" aria-label={m.picker.list}>
          {matches.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => pick({ kind: "existing", folderId: f.id, name: f.name, icon: f.icon })}
                className="flex w-full items-center gap-3 rounded-field px-3 py-2.5 text-left text-sm hover:bg-sunken"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-sunken text-ink-soft">
                  <FolderGlyph name={f.icon} size={16} />
                </span>
                <span className="flex-1 truncate font-medium">{f.name}</span>
                <span className="font-mono text-xs text-ink-faint">{f.ideaCount}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && !trimmed && (
            <li className="px-3 py-6 text-center text-sm text-ink-faint">{m.picker.empty}</li>
          )}
        </ul>

        {trimmed && !exact && (
          <div className="mt-4 rounded-field border border-line bg-sunken/60 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="truncate text-sm">
                {rich(m.picker.newFolder, { name: <strong className="font-semibold">{trimmed}</strong> })}
              </span>
              <Button
                size="sm"
                variant="primary"
                onClick={() => pick({ kind: "new", name: trimmed, icon: newIcon })}
              >
                <PlusIcon size={14} weight="bold" aria-hidden /> {m.picker.create}
              </Button>
            </div>
            <IconPicker value={newIcon} onChange={setNewIcon} />
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function ChoiceCheck() {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-on-accent">
      <CheckIcon size={12} weight="bold" aria-hidden />
    </span>
  );
}
