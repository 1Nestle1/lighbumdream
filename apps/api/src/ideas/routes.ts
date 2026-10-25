import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ConfirmIdeaBody,
  CreateIdeaBody,
  FavoriteBody,
  ListIdeasQuery,
  RelatedIdeasQuery,
  UpdateIdeaBody,
  type RelatedIdeasResponse,
} from "@lightbulb/shared";
import { requireUser } from "../auth/session.js";
import {
  confirmIdea,
  createIdea,
  deleteIdea,
  getIdea,
  listIdeas,
  pickUpIdeas,
  relatedIdeas,
  resuggest,
  setFavorite,
  updateIdea,
} from "./service.js";

const Params = z.object({ id: z.uuid() });

// Suggestions can call an LLM, so limit them per user rather than per IP.
const suggestRateLimit = {
  rateLimit: {
    max: 30,
    timeWindow: "1 minute",
    keyGenerator: (request: FastifyRequest) => request.user?.id ?? request.ip,
  },
};

export async function ideaRoutes(app: FastifyInstance) {
  app.get("/ideas", async (request) => {
    const user = requireUser(request);
    return listIdeas(user.id, ListIdeasQuery.parse(request.query));
  });

  app.post("/ideas", { config: suggestRateLimit }, async (request, reply) => {
    const user = requireUser(request);
    const body = CreateIdeaBody.parse(request.body);
    return reply.status(201).send(await createIdea(user.id, body, request.log));
  });

  // Static paths win over /ideas/:id in Fastify's router.
  app.get("/ideas/related", async (request): Promise<RelatedIdeasResponse> => {
    const user = requireUser(request);
    const { q, exclude, limit } = RelatedIdeasQuery.parse(request.query);
    return { ideas: await relatedIdeas(user.id, q, { exclude, limit }) };
  });

  app.get("/ideas/pick-up", async (request) => {
    const user = requireUser(request);
    return { ideas: await pickUpIdeas(user.id) };
  });

  app.get("/ideas/:id", async (request) => {
    const user = requireUser(request);
    return getIdea(user.id, Params.parse(request.params).id);
  });

  app.patch("/ideas/:id", async (request) => {
    const user = requireUser(request);
    return updateIdea(user.id, Params.parse(request.params).id, UpdateIdeaBody.parse(request.body));
  });

  app.post("/ideas/:id/favorite", async (request) => {
    const user = requireUser(request);
    return setFavorite(user.id, Params.parse(request.params).id, FavoriteBody.parse(request.body).favorite);
  });

  app.post("/ideas/:id/confirm", async (request) => {
    const user = requireUser(request);
    return confirmIdea(user.id, Params.parse(request.params).id, ConfirmIdeaBody.parse(request.body));
  });

  app.post("/ideas/:id/suggest", { config: suggestRateLimit }, async (request) => {
    const user = requireUser(request);
    return resuggest(user.id, Params.parse(request.params).id, request.log);
  });

  app.delete("/ideas/:id", async (request, reply) => {
    const user = requireUser(request);
    await deleteIdea(user.id, Params.parse(request.params).id);
    return reply.status(204).send();
  });
}
