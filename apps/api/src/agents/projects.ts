import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { ProjectCard, ProjectsResponse } from "@lightbulb/shared";
import { db } from "../db/client.js";
import { agentRunners, ideaRuns, ideas } from "../db/schema.js";
import { isOnline, listRunsForIdeas } from "./runs.js";

// The projects board: your starred favourites first, then the projects an agent worked on most
// recently. Each card carries the latest run (its state and progress) and the computer it last
// ran on, so a prompt can go straight back there.

const RECENT = 8;

export async function listProjects(userId: string): Promise<ProjectsResponse> {
  const favorites = await db
    .select({ id: ideas.id, title: ideas.title, nextStep: ideas.nextStep, folderId: ideas.folderId, projectPath: ideas.projectPath, favoriteAt: ideas.favoriteAt, updatedAt: ideas.updatedAt })
    .from(ideas)
    .where(and(eq(ideas.userId, userId), isNotNull(ideas.favoriteAt), isNull(ideas.archivedAt)))
    .orderBy(ideas.favoriteAt);

  // Ideas with agent work, by their latest run.
  const lastRun = sql<Date>`max(${ideaRuns.updatedAt})`;
  const recentIds = await db
    .select({ ideaId: ideaRuns.ideaId, lastRun })
    .from(ideaRuns)
    .innerJoin(ideas, eq(ideas.id, ideaRuns.ideaId))
    .where(and(eq(ideaRuns.userId, userId), isNull(ideas.favoriteAt), isNull(ideas.archivedAt)))
    .groupBy(ideaRuns.ideaId)
    .orderBy(desc(lastRun))
    .limit(RECENT);
  const recent = recentIds.length
    ? await db
        .select({ id: ideas.id, title: ideas.title, nextStep: ideas.nextStep, folderId: ideas.folderId, projectPath: ideas.projectPath, favoriteAt: ideas.favoriteAt, updatedAt: ideas.updatedAt })
        .from(ideas)
        .where(inArray(ideas.id, recentIds.map((r) => r.ideaId)))
    : [];
  const recentOrder = new Map(recentIds.map((r, i) => [r.ideaId, i]));
  recent.sort((a, b) => recentOrder.get(a.id)! - recentOrder.get(b.id)!);

  const all = [...favorites, ...recent];
  const ids = all.map((idea) => idea.id);
  const latest = await listRunsForIdeas(userId, ids);

  // The computer each project last ran on, even if its latest run was in the cloud.
  const runnerRows = ids.length
    ? await db
        .selectDistinctOn([ideaRuns.ideaId], {
          ideaId: ideaRuns.ideaId,
          id: agentRunners.id,
          name: agentRunners.name,
          lastSeenAt: agentRunners.lastSeenAt,
        })
        .from(ideaRuns)
        .innerJoin(agentRunners, eq(agentRunners.id, ideaRuns.runnerId))
        .where(inArray(ideaRuns.ideaId, ids))
        .orderBy(ideaRuns.ideaId, desc(ideaRuns.createdAt))
    : [];
  const runners = new Map(runnerRows.map((r) => [r.ideaId, { id: r.id, name: r.name, online: isOnline(r.lastSeenAt) }]));

  const card = (idea: (typeof all)[number]): ProjectCard => {
    const run = latest.get(idea.id) ?? null;
    const runAt = run ? new Date(run.updatedAt) : null;
    return {
      idea: { id: idea.id, title: idea.title, nextStep: idea.nextStep, folderId: idea.folderId, projectPath: idea.projectPath },
      favoriteAt: idea.favoriteAt?.toISOString() ?? null,
      latestRun: run,
      lastRunner: runners.get(idea.id) ?? null,
      lastActivityAt: (runAt && runAt > idea.updatedAt ? runAt : idea.updatedAt).toISOString(),
    };
  };
  return { favorites: favorites.map(card), recent: recent.map(card) };
}
