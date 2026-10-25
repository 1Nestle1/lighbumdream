import type {
  AgentsResponse,
  IntegrationProvider,
  IntegrationsResponse,
  PublishRunBody,
  ProjectsResponse,
  SendPromptBody,
  IdeaRun,
  IdeaRunsResponse,
  PairingInfo,
  Runner,
  StartRunBody,
  ApiErrorBody,
  ConfirmIdeaBody,
  ConfirmIdeaResponse,
  CreateFolderBody,
  Folder,
  FoldersResponse,
  HealthResponse,
  Idea,
  IdeasResponse,
  IdeaNote,
  IdeaNotebook,
  IdeaFile,
  IdeaStep,
  IdeaView,
  Locale,
  MagicLinkResponse,
  RelatedIdeasResponse,
  TelegramLinkResponse,
  TelegramStatus,
  TranscribeResponse,
  UpdateFolderBody,
  UpdateIdeaBody,
  User,
} from "@lightbulb/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      credentials: "same-origin",
      signal: init.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network", "Can't reach the server. Check your connection.");
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? "error", data?.message ?? res.statusText);
  }
  return data as T;
}

export interface IdeaListParams {
  view?: IdeaView;
  folderId?: string;
  q?: string;
  cursor?: string;
}

const qs = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  const s = search.toString();
  return s ? `?${s}` : "";
};

export const api = {
  health: () => request<HealthResponse>("/health"),
  me: () => request<{ user: User }>("/auth/me"),
  requestLink: (email: string, locale: Locale) =>
    request<MagicLinkResponse>("/auth/magic-link", { method: "POST", body: { email, locale } }),
  verify: (token: string) => request<{ user: User }>("/auth/verify", { method: "POST", body: { token } }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  updateMe: (body: { locale: Locale }) => request<{ user: User }>("/auth/me", { method: "PATCH", body }),

  folders: () => request<FoldersResponse>("/folders"),
  createFolder: (body: CreateFolderBody) => request<Folder>("/folders", { method: "POST", body }),
  updateFolder: (id: string, body: UpdateFolderBody) =>
    request<Folder>(`/folders/${id}`, { method: "PATCH", body }),
  deleteFolder: (id: string) => request<void>(`/folders/${id}`, { method: "DELETE" }),

  ideas: (params: IdeaListParams) => request<IdeasResponse>(`/ideas${qs({ ...params })}`),
  idea: (id: string) => request<Idea>(`/ideas/${id}`),
  createIdea: (body: { text: string; clipId?: string }) => request<Idea>("/ideas", { method: "POST", body }),
  related: (q: string, signal?: AbortSignal) =>
    request<RelatedIdeasResponse>(`/ideas/related${qs({ q })}`, { signal }),
  pickUp: () => request<{ ideas: Idea[] }>("/ideas/pick-up"),
  /** `language` is what's being spoken; auto-detection guesses wrong on short clips. */
  transcribe: ({ audio, language }: { audio: Blob; language: Locale }) => {
    const form = new FormData();
    const ext = audio.type.includes("mp4") ? "m4a" : audio.type.includes("ogg") ? "ogg" : "webm";
    form.append("file", audio, `idea.${ext}`);
    return request<TranscribeResponse>(`/voice/transcribe${qs({ language })}`, { method: "POST", form });
  },
  audioUrl: (ideaId: string) => `/api/ideas/${ideaId}/audio`,
  updateIdea: (id: string, body: UpdateIdeaBody) =>
    request<Idea>(`/ideas/${id}`, { method: "PATCH", body }),
  confirmIdea: (id: string, body: ConfirmIdeaBody) =>
    request<ConfirmIdeaResponse>(`/ideas/${id}/confirm`, { method: "POST", body }),
  resuggest: (id: string) => request<Idea>(`/ideas/${id}/suggest`, { method: "POST" }),
  deleteIdea: (id: string) => request<void>(`/ideas/${id}`, { method: "DELETE" }),

  notebook: (ideaId: string) => request<IdeaNotebook>(`/ideas/${ideaId}/notebook`),
  addStep: (ideaId: string, text: string) =>
    request<IdeaStep>(`/ideas/${ideaId}/steps`, { method: "POST", body: { text } }),
  updateStep: (stepId: string, body: { text?: string; done?: boolean }) =>
    request<IdeaStep>(`/steps/${stepId}`, { method: "PATCH", body }),
  makeStepNext: (stepId: string) => request<IdeaStep>(`/steps/${stepId}/next`, { method: "POST" }),
  deleteStep: (stepId: string) => request<void>(`/steps/${stepId}`, { method: "DELETE" }),
  addNote: (ideaId: string, body: { text: string; clipId?: string }) =>
    request<IdeaNote>(`/ideas/${ideaId}/notes`, { method: "POST", body }),
  deleteNote: (noteId: string) => request<void>(`/notes/${noteId}`, { method: "DELETE" }),
  noteAudioUrl: (noteId: string) => `/api/notes/${noteId}/audio`,
  uploadFile: (ideaId: string, file: File) => {
    const form = new FormData();
    form.append("file", file, file.name);
    return request<IdeaFile>(`/ideas/${ideaId}/files`, { method: "POST", form });
  },
  deleteFile: (fileId: string) => request<void>(`/files/${fileId}`, { method: "DELETE" }),

  agents: () => request<AgentsResponse>("/agents"),
  renameRunner: (id: string, name: string) => request<Runner>(`/agents/runners/${id}`, { method: "PATCH", body: { name } }),
  removeRunner: (id: string) => request<void>(`/agents/runners/${id}`, { method: "DELETE" }),
  pairing: (code: string) => request<PairingInfo>(`/agents/pairings/${encodeURIComponent(code)}`),
  approvePairing: (userCode: string) =>
    request<PairingInfo>("/agents/pairings/approve", { method: "POST", body: { userCode } }),
  runs: (ideaId: string) => request<IdeaRunsResponse>(`/ideas/${ideaId}/runs`),
  startRun: (ideaId: string, body: StartRunBody) =>
    request<IdeaRun>(`/ideas/${ideaId}/runs`, { method: "POST", body }),
  chooseOption: (runId: string, body: { index: number; comment?: string }) =>
    request<IdeaRun>(`/runs/${runId}/choose`, { method: "POST", body }),
  reviseRun: (runId: string, comment: string) =>
    request<IdeaRun>(`/runs/${runId}/revise`, { method: "POST", body: { comment } }),
  approveRun: (runId: string, planVersion: number) =>
    request<IdeaRun>(`/runs/${runId}/approve`, { method: "POST", body: { planVersion } }),
  retryRun: (runId: string) => request<IdeaRun>(`/runs/${runId}/retry`, { method: "POST" }),
  cancelRun: (runId: string) => request<IdeaRun>(`/runs/${runId}/cancel`, { method: "POST" }),
  projects: () => request<ProjectsResponse>("/projects"),
  sendPrompt: (ideaId: string, body: SendPromptBody) =>
    request<IdeaRun>(`/ideas/${ideaId}/prompts`, { method: "POST", body }),
  setFavorite: (ideaId: string, favorite: boolean) =>
    request<Idea>(`/ideas/${ideaId}/favorite`, { method: "POST", body: { favorite } }),
  publishRun: (runId: string, body: PublishRunBody = {}) =>
    request<IdeaRun>(`/runs/${runId}/publish`, { method: "POST", body }),

  integrations: () => request<IntegrationsResponse>("/integrations"),
  connectIntegration: (provider: IntegrationProvider, secret: string) =>
    request<IntegrationsResponse>(`/integrations/${provider}`, { method: "PUT", body: { secret } }),
  disconnectIntegration: (provider: IntegrationProvider) =>
    request<void>(`/integrations/${provider}`, { method: "DELETE" }),

  telegramStatus: () => request<TelegramStatus>("/telegram/status"),
  telegramLink: () => request<TelegramLinkResponse>("/telegram/link", { method: "POST" }),
  telegramUnlink: () => request<void>("/telegram/link", { method: "DELETE" }),
};
