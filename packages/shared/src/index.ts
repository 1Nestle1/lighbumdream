import { z } from "zod";
import { FOLDER_ICONS, LIMITS, LOCALES } from "./constants";

export * from "./constants";
export * from "./agents";

export const FolderIconSchema = z.enum(FOLDER_ICONS);
export type FolderIcon = z.infer<typeof FolderIconSchema>;

export const LocaleSchema = z.enum(LOCALES);

// ---------- Auth ----------

export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const RequestMagicLinkBody = z.object({
  email: EmailSchema,
  /** Language of the sign-in page: used for the email and saved to the account on sign-in. */
  locale: LocaleSchema.optional(),
});
export type RequestMagicLinkBody = z.infer<typeof RequestMagicLinkBody>;

export const VerifyMagicLinkBody = z.object({ token: z.string().min(20).max(200) });
export type VerifyMagicLinkBody = z.infer<typeof VerifyMagicLinkBody>;

export const UserSchema = z.object({ id: z.uuid(), email: z.string(), locale: LocaleSchema });
export type User = z.infer<typeof UserSchema>;

export const UpdateMeBody = z.object({ locale: LocaleSchema });
export type UpdateMeBody = z.infer<typeof UpdateMeBody>;

export const TranscribeQuery = z.object({
  /** Language being spoken. Defaults to the account's language; auto-detection guesses wrong on short clips. */
  language: LocaleSchema.optional(),
});

export interface MagicLinkResponse {
  ok: true;
  /** Only present in development when no mailer is configured. */
  devLink?: string;
}

// ---------- Folders ----------

export const FolderNameSchema = z.string().trim().min(1).max(60);

export const CreateFolderBody = z.object({
  name: FolderNameSchema,
  icon: FolderIconSchema.default("Folder"),
});
export type CreateFolderBody = z.input<typeof CreateFolderBody>;

export const UpdateFolderBody = z.object({
  name: FolderNameSchema.optional(),
  icon: FolderIconSchema.optional(),
});
export type UpdateFolderBody = z.infer<typeof UpdateFolderBody>;

export interface Folder {
  id: string;
  name: string;
  icon: FolderIcon;
  ideaCount: number;
  createdAt: string;
}

export interface BankCounts {
  all: number;
  inbox: number;
  archived: number;
  thisWeek: number;
}

export interface FoldersResponse {
  folders: Folder[];
  counts: BankCounts;
}

// ---------- Suggestions ----------

export const FolderChoiceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("existing"),
    folderId: z.uuid(),
    name: z.string(),
    icon: FolderIconSchema,
  }),
  z.object({
    kind: z.literal("new"),
    name: FolderNameSchema,
    icon: FolderIconSchema,
  }),
]);
export type FolderChoice = z.infer<typeof FolderChoiceSchema>;

export interface Suggestion {
  title: string;
  summary: string;
  primary: FolderChoice;
  alternatives: FolderChoice[];
  /** One concrete action (15 minutes or less) that gets the idea moving. Absent on older rows. */
  firstStep?: string;
  /** "ai" when an LLM produced it, "heuristic" for the offline fallback. */
  source: "ai" | "heuristic";
  createdAt: string;
}

// ---------- Ideas ----------

export const IdeaStatusSchema = z.enum(["inbox", "filed"]);
export type IdeaStatus = z.infer<typeof IdeaStatusSchema>;

export interface Idea {
  id: string;
  title: string;
  body: string;
  status: IdeaStatus;
  folderId: string | null;
  suggestion: Suggestion | null;
  /** The first unchecked step: the smallest next action. */
  nextStep: string | null;
  /** True when the idea was captured by voice and the recording is kept. */
  hasAudio: boolean;
  /** Set when you star the idea as a favourite project. */
  favoriteAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Search excerpt. Matches are wrapped in SNIPPET_MARK_START / SNIPPET_MARK_END
   * so the client can highlight without rendering HTML.
   */
  snippet?: string;
}

export const CreateIdeaBody = z.object({
  text: z.string().trim().min(1).max(LIMITS.bodyChars),
  /** Voice recording to attach, from POST /voice/transcribe. */
  clipId: z.uuid().optional(),
});
export type CreateIdeaBody = z.infer<typeof CreateIdeaBody>;

export const UpdateIdeaBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().min(1).max(LIMITS.bodyChars).optional(),
  /** Moving to null sends the idea back to the inbox. */
  folderId: z.uuid().nullable().optional(),
  archived: z.boolean().optional(),
});
export type UpdateIdeaBody = z.infer<typeof UpdateIdeaBody>;

// ---------- Idea page ----------
// Deliberately restricted: a short description, a capped checklist, short notes and
// attachments. No free-form documents, so every addition moves the idea forward.

export interface IdeaStep {
  id: string;
  text: string;
  done: boolean;
  doneAt: string | null;
  createdAt: string;
}

export interface IdeaNote {
  id: string;
  text: string;
  /** Voice note: the original recording can be played back. */
  hasAudio: boolean;
  createdAt: string;
}

export interface IdeaFile {
  id: string;
  kind: "image" | "file";
  name: string;
  mime: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
}

export interface IdeaNotebook {
  steps: IdeaStep[];
  notes: IdeaNote[];
  files: IdeaFile[];
}

export const AddStepBody = z.object({ text: z.string().trim().min(1).max(LIMITS.stepChars) });
export const UpdateStepBody = z.object({
  text: z.string().trim().min(1).max(LIMITS.stepChars).optional(),
  done: z.boolean().optional(),
});
export type UpdateStepBody = z.infer<typeof UpdateStepBody>;

export const AddNoteBody = z.object({
  text: z.string().trim().min(1).max(LIMITS.noteChars),
  clipId: z.uuid().optional(),
});
export type AddNoteBody = z.infer<typeof AddNoteBody>;

export const ConfirmIdeaBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("existing"), folderId: z.uuid() }),
    z.object({ kind: z.literal("new"), name: FolderNameSchema, icon: FolderIconSchema }),
  ]),
});
export type ConfirmIdeaBody = z.infer<typeof ConfirmIdeaBody>;

export const IdeaViewSchema = z.enum(["all", "inbox", "filed", "archive"]);
export type IdeaView = z.infer<typeof IdeaViewSchema>;

export const ListIdeasQuery = z.object({
  view: IdeaViewSchema.default("all"),
  folderId: z.uuid().optional(),
  q: z.string().trim().max(200).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListIdeasQuery = z.input<typeof ListIdeasQuery>;

export const RelatedIdeasQuery = z.object({
  q: z.string().trim().min(1).max(5000),
  exclude: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(6),
});

export interface RelatedIdea extends Idea {
  /** Very likely the same idea written again. */
  duplicate: boolean;
}

export interface RelatedIdeasResponse {
  ideas: RelatedIdea[];
}

export interface TranscribeResponse {
  clipId: string;
  text: string;
}

export interface IdeasResponse {
  ideas: Idea[];
  nextCursor: string | null;
}

export interface ConfirmIdeaResponse {
  idea: Idea;
  folder: Folder;
}

export interface HealthResponse {
  ok: true;
  aiSuggestions: boolean;
  voice: boolean;
  telegram: { enabled: boolean; botUsername: string | null };
}

export interface TelegramLinkResponse {
  url: string;
  expiresAt: string;
}

export interface TelegramStatus {
  linked: boolean;
  botUsername: string | null;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  issues?: unknown;
}
