import {
  QueryClient,
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  ConfirmIdeaBody,
  CreateFolderBody,
  IdeaRun,
  IdeaRunsResponse,
  IdeaView,
  IntegrationProvider,
  RunStatus,
  SendPromptBody,
  StartRunBody,
  UpdateFolderBody,
  UpdateIdeaBody,
  User,
} from "@lightbulb/shared";
import { api, ApiError } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

// A 401 anywhere means the session is gone: drop the user so the auth guard redirects.
queryClient.getQueryCache().subscribe((event) => {
  const err = event.type === "updated" ? event.query.state.error : null;
  if (err instanceof ApiError && err.status === 401 && event.query.queryKey[0] !== "me") {
    queryClient.setQueryData(["me"], null);
  }
});

export const keys = {
  me: ["me"] as const,
  folders: ["folders"] as const,
  ideas: (view: IdeaView, folderId?: string) => ["ideas", view, folderId ?? null] as const,
  idea: (id: string) => ["idea", id] as const,
  search: (q: string) => ["search", q] as const,
  related: (q: string) => ["related", q] as const,
  pickUp: ["pick-up"] as const,
  health: ["health"] as const,
  telegram: ["telegram"] as const,
  notebook: (ideaId: string) => ["notebook", ideaId] as const,
  agents: ["agents"] as const,
  integrations: ["integrations"] as const,
  projects: ["projects"] as const,
  runs: (ideaId: string) => ["runs", ideaId] as const,
};

export function useNotebook(ideaId: string) {
  return useQuery({ queryKey: keys.notebook(ideaId), queryFn: () => api.notebook(ideaId) });
}

/**
 * Mutations on an idea page. Steps change the idea's next step, and any addition
 * counts as touching the idea, so lists, "Pick one up" and the idea itself refresh too.
 */
export function useNotebookActions(ideaId: string) {
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.notebook(ideaId) }),
      qc.invalidateQueries({ queryKey: keys.idea(ideaId) }),
      qc.invalidateQueries({ queryKey: ["ideas"] }),
      qc.invalidateQueries({ queryKey: ["related"] }),
      qc.invalidateQueries({ queryKey: keys.pickUp }),
    ]);
  const mutation = <A, R>(fn: (arg: A) => Promise<R>) => ({ mutationFn: fn, onSuccess: refresh });
  return {
    addStep: useMutation(mutation((text: string) => api.addStep(ideaId, text))),
    updateStep: useMutation(
      mutation(({ id, ...body }: { id: string; text?: string; done?: boolean }) => api.updateStep(id, body)),
    ),
    makeStepNext: useMutation(mutation((id: string) => api.makeStepNext(id))),
    deleteStep: useMutation(mutation((id: string) => api.deleteStep(id))),
    addNote: useMutation(mutation((body: { text: string; clipId?: string }) => api.addNote(ideaId, body))),
    deleteNote: useMutation(mutation((id: string) => api.deleteNote(id))),
    uploadFile: useMutation(mutation((file: File) => api.uploadFile(ideaId, file))),
    deleteFile: useMutation(mutation((id: string) => api.deleteFile(id))),
  };
}

/** Adds a note to any idea (used by the bar's "Add to it"). */
export function useAddNoteTo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ideaId, ...body }: { ideaId: string; text: string; clipId?: string }) => api.addNote(ideaId, body),
    onSuccess: (_note, { ideaId }) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.notebook(ideaId) }),
        qc.invalidateQueries({ queryKey: ["ideas"] }),
        qc.invalidateQueries({ queryKey: ["related"] }),
        qc.invalidateQueries({ queryKey: keys.pickUp }),
      ]),
  });
}

export function useHealth() {
  return useQuery({ queryKey: keys.health, queryFn: api.health, staleTime: 60_000 });
}

/** Ideas related to what's being typed in the bar. Aborts stale requests as you keep typing. */
export function useRelated(q: string) {
  return useQuery({
    queryKey: keys.related(q),
    queryFn: ({ signal }) => api.related(q, signal),
    enabled: q.trim().length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

export function usePickUp() {
  return useQuery({ queryKey: keys.pickUp, queryFn: api.pickUp });
}

/** Cloud availability and the user's connected computers. Polls while `live` (e.g. a dialog is open). */
export function useAgents({ live = false } = {}) {
  return useQuery({
    queryKey: keys.agents,
    queryFn: api.agents,
    refetchInterval: live ? 4_000 : 30_000,
  });
}

const WORKING: readonly RunStatus[] = ["options_pending", "plan_pending", "building"];

/** An idea's agent runs, newest first. Polls quickly while an agent is working on one. */
export function useRuns(ideaId: string) {
  return useQuery({
    queryKey: keys.runs(ideaId),
    queryFn: () => api.runs(ideaId),
    refetchInterval: (query) => {
      const latest = query.state.data?.runs[0];
      if (!latest) return false;
      if (WORKING.includes(latest.status)) return 2_500;
      return latest.status === "options_ready" || latest.status === "plan_ready" ? 15_000 : false;
    },
  });
}

/** Moves a run along. Each action returns the updated run, which replaces it in the cache. */
export function useRunActions(ideaId: string) {
  const qc = useQueryClient();
  const put = (run: IdeaRun) => {
    qc.setQueryData<IdeaRunsResponse>(keys.runs(ideaId), (old) => {
      const rest = (old?.runs ?? []).filter((r) => r.id !== run.id);
      return { runs: [run, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
    });
  };
  const onError = (err: Error) => {
    // Someone (or another tab) already moved it: show where it is now.
    if (err instanceof ApiError && (err.code === "run_moved_on" || err.code === "run_active")) {
      void qc.invalidateQueries({ queryKey: keys.runs(ideaId) });
    }
  };
  const mutation = <A,>(fn: (arg: A) => Promise<IdeaRun>) => ({ mutationFn: fn, onSuccess: put, onError });
  return {
    start: useMutation(mutation((body: StartRunBody) => api.startRun(ideaId, body))),
    choose: useMutation(
      mutation(({ runId, ...body }: { runId: string; index: number; comment?: string }) => api.chooseOption(runId, body)),
    ),
    revise: useMutation(mutation(({ runId, comment }: { runId: string; comment: string }) => api.reviseRun(runId, comment))),
    approve: useMutation(
      mutation(({ runId, planVersion }: { runId: string; planVersion: number }) => api.approveRun(runId, planVersion)),
    ),
    retry: useMutation(mutation((runId: string) => api.retryRun(runId))),
    cancel: useMutation(mutation((runId: string) => api.cancelRun(runId))),
    publish: useMutation(mutation((runId: string) => api.publishRun(runId))),
  };
}

/** The projects board. Refreshes every few seconds while any agent is working. */
export function useProjects() {
  return useQuery({
    queryKey: keys.projects,
    queryFn: api.projects,
    refetchInterval: (query) => {
      const cards = [...(query.state.data?.favorites ?? []), ...(query.state.data?.recent ?? [])];
      return cards.some((c) => c.latestRun && WORKING.includes(c.latestRun.status)) ? 3_000 : 15_000;
    },
  });
}

/** Sends a prompt to one of your computers. The project's run list and the board refresh. */
export function useSendPrompt(ideaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SendPromptBody) => api.sendPrompt(ideaId, body),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.runs(ideaId) }),
        qc.invalidateQueries({ queryKey: keys.projects }),
      ]),
  });
}

export function useFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ideaId, favorite }: { ideaId: string; favorite: boolean }) => api.setFavorite(ideaId, favorite),
    onSuccess: (idea) => {
      qc.setQueryData(keys.idea(idea.id), idea);
      return qc.invalidateQueries({ queryKey: keys.projects });
    },
  });
}

export function useIntegrations() {
  return useQuery({ queryKey: keys.integrations, queryFn: api.integrations });
}

/** Connecting or removing a key changes what the agent section offers (cloud on your own key). */
export function useIntegrationActions() {
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.integrations }),
      qc.invalidateQueries({ queryKey: keys.agents }),
    ]);
  return {
    connect: useMutation({
      mutationFn: ({ provider, secret }: { provider: IntegrationProvider; secret: string }) =>
        api.connectIntegration(provider, secret),
      onSuccess: refresh,
    }),
    disconnect: useMutation({ mutationFn: api.disconnectIntegration, onSuccess: refresh }),
  };
}

export function useTelegramUnlink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.telegramUnlink,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.telegram }),
  });
}

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async (): Promise<User | null> => {
      try {
        return (await api.me()).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
  });
}

export function useFolders() {
  return useQuery({ queryKey: keys.folders, queryFn: api.folders });
}

export function useIdeas(view: IdeaView, folderId?: string) {
  return useInfiniteQuery({
    queryKey: keys.ideas(view, folderId),
    queryFn: ({ pageParam }) => api.ideas({ view, folderId, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useIdea(id: string | null) {
  return useQuery({
    queryKey: keys.idea(id ?? ""),
    queryFn: () => api.idea(id!),
    enabled: Boolean(id),
  });
}

export function useSearch(q: string) {
  return useQuery({
    queryKey: keys.search(q),
    queryFn: () => api.ideas({ q }),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5_000,
  });
}

/** Anything that changes ideas can change counts, lists and search results. */
function useInvalidateBank({ refetchIdeaDetail = true } = {}) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["ideas"] }),
      qc.invalidateQueries({ queryKey: ["idea"], refetchType: refetchIdeaDetail ? "active" : "none" }),
      qc.invalidateQueries({ queryKey: ["search"] }),
      qc.invalidateQueries({ queryKey: ["related"] }),
      qc.invalidateQueries({ queryKey: keys.pickUp }),
      qc.invalidateQueries({ queryKey: keys.folders }),
    ]);
}

export function useCreateIdea() {
  const invalidate = useInvalidateBank();
  return useMutation({ mutationFn: api.createIdea, onSuccess: invalidate });
}

export function useConfirmIdea() {
  const invalidate = useInvalidateBank();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ConfirmIdeaBody }) => api.confirmIdea(id, body),
    onSuccess: invalidate,
  });
}

export function useUpdateIdea() {
  const invalidate = useInvalidateBank();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateIdeaBody }) => api.updateIdea(id, body),
    onSuccess: invalidate,
  });
}

export function useResuggest() {
  const invalidate = useInvalidateBank();
  return useMutation({ mutationFn: api.resuggest, onSuccess: invalidate });
}

export function useDeleteIdea() {
  // The open drawer would refetch a deleted idea and flash a 404 before closing.
  const invalidate = useInvalidateBank({ refetchIdeaDetail: false });
  return useMutation({ mutationFn: api.deleteIdea, onSuccess: invalidate });
}

export function useCreateFolder() {
  const invalidate = useInvalidateBank();
  return useMutation({ mutationFn: (body: CreateFolderBody) => api.createFolder(body), onSuccess: invalidate });
}

export function useUpdateFolder() {
  const invalidate = useInvalidateBank();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateFolderBody }) => api.updateFolder(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteFolder() {
  const invalidate = useInvalidateBank();
  return useMutation({ mutationFn: api.deleteFolder, onSuccess: invalidate });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(keys.me, null);
    },
  });
}
