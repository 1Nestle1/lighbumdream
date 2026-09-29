import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CreateFolderBody, UpdateFolderBody, type FoldersResponse } from "@lightbulb/shared";
import { requireUser } from "../auth/session.js";
import {
  createFolder,
  deleteFolder,
  getBankCounts,
  listFolders,
  updateFolder,
} from "./service.js";

const Params = z.object({ id: z.uuid() });

export async function folderRoutes(app: FastifyInstance) {
  app.get("/folders", async (request): Promise<FoldersResponse> => {
    const user = requireUser(request);
    const [folders, counts] = await Promise.all([listFolders(user.id), getBankCounts(user.id)]);
    return { folders, counts };
  });

  app.post("/folders", async (request, reply) => {
    const user = requireUser(request);
    const folder = await createFolder(user.id, CreateFolderBody.parse(request.body));
    return reply.status(201).send(folder);
  });

  app.patch("/folders/:id", async (request) => {
    const user = requireUser(request);
    const { id } = Params.parse(request.params);
    return updateFolder(user.id, id, UpdateFolderBody.parse(request.body));
  });

  app.delete("/folders/:id", async (request, reply) => {
    const user = requireUser(request);
    const { id } = Params.parse(request.params);
    await deleteFolder(user.id, id);
    return reply.status(204).send();
  });
}
