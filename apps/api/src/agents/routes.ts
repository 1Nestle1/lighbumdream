import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ApprovePairingBody,
  LIMITS,
  PublishRunBody,
  SendPromptBody,
  type ProjectsResponse,
  ApproveRunBody,
  ChooseOptionBody,
  RenameRunnerBody,
  ReviseRunBody,
  RunnerFailBody,
  RunnerHeartbeatBody,
  RunnerHelloBody,
  RunnerOutputBody,
  RunnerPairBody,
  RunnerPairPollBody,
  RunnerProgressBody,
  RunnerResultBody,
  StartRunBody,
  UserCodeSchema,
  type AgentsResponse,
  type IdeaRunsResponse,
  type RunnerClaimResponse,
} from "@lightbulb/shared";
import { requireUser } from "../auth/session.js";
import { env } from "../env.js";
import { HttpError } from "../lib/http.js";
import { readFileStream } from "../storage/files.js";
import {
  approvePairing,
  listRunners,
  pairingInfo,
  pollPairing,
  removeRunner,
  renameRunner,
  requireRunner,
  runnerHello,
  startPairing,
} from "./runners.js";
import {
  approveRun,
  attachArchive,
  buildTask,
  cancelRun,
  chooseOption,
  claimRun,
  cloudFor,
  heartbeat,
  listRuns,
  publishRun,
  reportFailure,
  reportOptions,
  reportPlan,
  reportProgress,
  reportResult,
  retryRun,
  sendPrompt,
  reviseRun,
  runnerFile,
  startRun,
  type Owner,
} from "./runs.js";
import { listProjects } from "./projects.js";
import { waitForWork } from "./signals.js";

const Params = z.object({ id: z.uuid() });
const id = (request: FastifyRequest) => Params.parse(request.params).id;

const RUNNER_BUNDLE = path.resolve(env.RUNNER_BUNDLE);

/** How long a runner's claim request waits for work before answering "nothing yet". */
const LONG_POLL_MS = 25_000;

const byIp = (max: number) => ({
  config: { rateLimit: { max, timeWindow: "1 minute", keyGenerator: (request: FastifyRequest) => request.ip } },
});

export async function agentRoutes(app: FastifyInstance) {
  // ---------- Signed-in user ----------

  app.get("/agents", async (request): Promise<AgentsResponse> => {
    const user = requireUser(request);
    const cloud = await cloudFor(user.id);
    return {
      cloud: { ...cloud, budgetUsd: env.CLOUD_BUILD_BUDGET_USD, buildsPerDay: env.CLOUD_BUILDS_PER_DAY },
      runners: await listRunners(user.id),
    };
  });

  app.get("/agents/pairings/:code", async (request) => {
    requireUser(request);
    const code = UserCodeSchema.parse((request.params as { code: string }).code);
    return pairingInfo(code);
  });

  app.post("/agents/pairings/approve", byIp(20), async (request) => {
    const user = requireUser(request);
    const { userCode } = ApprovePairingBody.parse(request.body);
    return approvePairing(user.id, userCode);
  });

  app.patch("/agents/runners/:id", async (request) =>
    renameRunner(requireUser(request).id, id(request), RenameRunnerBody.parse(request.body).name),
  );

  app.delete("/agents/runners/:id", async (request, reply) => {
    await removeRunner(requireUser(request).id, id(request));
    return reply.status(204).send();
  });

  app.get("/ideas/:id/runs", async (request): Promise<IdeaRunsResponse> => ({
    runs: await listRuns(requireUser(request).id, id(request)),
  }));

  app.post("/ideas/:id/runs", async (request, reply) => {
    const run = await startRun(requireUser(request).id, id(request), StartRunBody.parse(request.body));
    return reply.status(201).send(run);
  });

  app.get("/projects", async (request): Promise<ProjectsResponse> => listProjects(requireUser(request).id));

  app.post(
    "/ideas/:id/prompts",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute", keyGenerator: (r: FastifyRequest) => r.user?.id ?? r.ip } } },
    async (request, reply) => {
      const run = await sendPrompt(requireUser(request).id, id(request), SendPromptBody.parse(request.body));
      return reply.status(201).send(run);
    },
  );

  app.post("/runs/:id/choose", async (request) =>
    chooseOption(requireUser(request).id, id(request), ChooseOptionBody.parse(request.body)),
  );

  app.post("/runs/:id/revise", async (request) =>
    reviseRun(requireUser(request).id, id(request), ReviseRunBody.parse(request.body).comment),
  );

  app.post("/runs/:id/approve", async (request) =>
    approveRun(requireUser(request).id, id(request), ApproveRunBody.parse(request.body).planVersion),
  );

  app.post("/runs/:id/retry", async (request) => retryRun(requireUser(request).id, id(request)));

  app.post("/runs/:id/cancel", async (request) => cancelRun(requireUser(request).id, id(request)));

  app.post(
    "/runs/:id/publish",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute", keyGenerator: (r: FastifyRequest) => r.user?.id ?? r.ip } } },
    async (request) => publishRun(requireUser(request).id, id(request), PublishRunBody.parse(request.body ?? {})),
  );

  // ---------- The `lightbulb` CLI ----------

  app.post("/runner/pair", byIp(10), async (request) => {
    const { name, platform } = RunnerPairBody.parse(request.body);
    return startPairing(name, platform);
  });

  app.post("/runner/pair/poll", byIp(40), async (request) =>
    pollPairing(RunnerPairPollBody.parse(request.body).deviceCode),
  );

  // The CLI itself, with this site's address built in, so `node lightbulb.cjs` needs no setup.
  app.get("/runner/cli", byIp(20), async (_request, reply) => {
    const bundle = await readFile(RUNNER_BUNDLE, "utf8").catch(() => null);
    if (!bundle) {
      throw new HttpError(404, "runner_not_built", "The runner isn't built on this server: npm run build -w @lightbulb/runner");
    }
    const origin = JSON.stringify(env.WEB_ORIGIN).slice(1, -1);
    return reply
      .header("content-type", "application/javascript; charset=utf-8")
      .header("content-disposition", 'attachment; filename="lightbulb.cjs"')
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "no-cache")
      .send(bundle.replace("__LIGHTBULB_SERVER__", origin));
  });

  app.post("/runner/logout", async (request, reply) => {
    const runner = await requireRunner(request);
    await removeRunner(runner.userId, runner.id);
    return reply.status(204).send();
  });

  app.post("/runner/hello", async (request) => {
    const runner = await requireRunner(request);
    return runnerHello(runner, RunnerHelloBody.parse(request.body));
  });

  // Long poll: answers as soon as there is work for this computer, or after LONG_POLL_MS.
  app.post("/runner/claim", async (request, reply): Promise<RunnerClaimResponse> => {
    const runner = await requireRunner(request);
    const owner: Owner = { kind: "runner", runnerId: runner.id };
    const gone = new AbortController();
    reply.raw.on("close", () => gone.abort());
    const deadline = Date.now() + LONG_POLL_MS;
    while (!gone.signal.aborted) {
      const row = await claimRun(owner);
      if (row) return { task: await buildTask(row) };
      const left = deadline - Date.now();
      if (left <= 0) break;
      // Wake on a signal, or re-check every few seconds for work queued by another server.
      await waitForWork(runner.id, Math.min(left, 5_000), gone.signal);
    }
    return { task: null };
  });

  const runnerOwner = async (request: FastifyRequest): Promise<Owner> => ({
    kind: "runner",
    runnerId: (await requireRunner(request)).id,
  });

  app.post("/runner/runs/:id/heartbeat", async (request) => {
    const { leaseId } = RunnerHeartbeatBody.parse(request.body);
    return heartbeat(await runnerOwner(request), id(request), leaseId);
  });

  app.post("/runner/runs/:id/progress", async (request) => {
    const { leaseId, lines } = RunnerProgressBody.parse(request.body);
    return reportProgress(await runnerOwner(request), id(request), leaseId, lines);
  });

  app.post("/runner/runs/:id/options", async (request) => {
    const { leaseId, output } = RunnerOutputBody.parse(request.body);
    return reportOptions(await runnerOwner(request), id(request), leaseId, output);
  });

  app.post("/runner/runs/:id/plan", async (request) => {
    const { leaseId, output } = RunnerOutputBody.parse(request.body);
    return reportPlan(await runnerOwner(request), id(request), leaseId, output);
  });

  app.post("/runner/runs/:id/result", async (request) => {
    const { leaseId, output, location, archiveFileId } = RunnerResultBody.parse(request.body);
    return reportResult(await runnerOwner(request), id(request), leaseId, output, { location, archiveFileId });
  });

  // The project folder as a zip, sent by the CLI before its result. Raw body, so no multipart here.
  app.addContentTypeParser("application/zip", { parseAs: "buffer", bodyLimit: LIMITS.fileBytes }, (_req, body, done) =>
    done(null, body),
  );
  app.post("/runner/runs/:id/archive", async (request, reply) => {
    const runner = await requireRunner(request);
    const { leaseId } = z.object({ leaseId: z.uuid() }).parse(request.query);
    if (!Buffer.isBuffer(request.body)) throw new HttpError(415, "unsupported_file", "Send the zip as application/zip");
    const file = await attachArchive(runner.id, id(request), leaseId, request.body);
    return reply.status(201).send({ fileId: file.id, name: file.name });
  });

  app.post("/runner/runs/:id/fail", async (request) => {
    const { leaseId, message, code } = RunnerFailBody.parse(request.body);
    return reportFailure(await runnerOwner(request), id(request), leaseId, message, code);
  });

  app.get("/runner/files/:id", async (request, reply) => {
    const runner = await requireRunner(request);
    const file = await runnerFile(runner.id, id(request));
    return reply
      .header("content-type", file.mime)
      .header("x-content-type-options", "nosniff")
      .header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`)
      .send(readFileStream(file.storageKey));
  });
}
