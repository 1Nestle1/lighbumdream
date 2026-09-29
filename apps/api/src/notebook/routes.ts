import type { FastifyInstance, FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { z } from "zod";
import { AddNoteBody, AddStepBody, LIMITS, UpdateStepBody } from "@lightbulb/shared";
import { requireUser } from "../auth/session.js";
import { HttpError } from "../lib/http.js";
import { readFileStream } from "../storage/files.js";
import {
  addFile,
  addNote,
  addStep,
  deleteFile,
  deleteNote,
  deleteStep,
  getFile,
  getNoteAudio,
  getNotebook,
  makeStepNext,
  updateStep,
} from "./service.js";

const Params = z.object({ id: z.uuid() });
const id = (request: FastifyRequest) => Params.parse(request.params).id;

export async function notebookRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: LIMITS.fileBytes, files: 1, fields: 0 } });

  app.get("/ideas/:id/notebook", async (request) => getNotebook(requireUser(request).id, id(request)));

  // ---------- Steps ----------

  app.post("/ideas/:id/steps", async (request, reply) => {
    const { text } = AddStepBody.parse(request.body);
    return reply.status(201).send(await addStep(requireUser(request).id, id(request), text));
  });

  app.patch("/steps/:id", async (request) =>
    updateStep(requireUser(request).id, id(request), UpdateStepBody.parse(request.body)),
  );

  app.post("/steps/:id/next", async (request) => makeStepNext(requireUser(request).id, id(request)));

  app.delete("/steps/:id", async (request, reply) => {
    await deleteStep(requireUser(request).id, id(request));
    return reply.status(204).send();
  });

  // ---------- Notes ----------

  app.post("/ideas/:id/notes", async (request, reply) => {
    const body = AddNoteBody.parse(request.body);
    return reply.status(201).send(await addNote(requireUser(request).id, id(request), body));
  });

  app.delete("/notes/:id", async (request, reply) => {
    await deleteNote(requireUser(request).id, id(request));
    return reply.status(204).send();
  });

  app.get("/notes/:id/audio", async (request, reply) => {
    const clip = await getNoteAudio(requireUser(request).id, id(request));
    return reply.header("content-type", clip.mime).header("cache-control", "private, max-age=3600").send(clip.data);
  });

  // ---------- Files ----------

  app.post(
    "/ideas/:id/files",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
          keyGenerator: (request: FastifyRequest) => request.user?.id ?? request.ip,
        },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const file = await request.file();
      if (!file) throw new HttpError(400, "no_file", "Attach a file as the `file` field");
      const data = await file.toBuffer(); // throws 413 past LIMITS.fileBytes
      const saved = await addFile(user.id, id(request), { name: file.filename, mime: file.mimetype, data });
      return reply.status(201).send(saved);
    },
  );

  app.get("/files/:id", async (request, reply) => {
    const row = await getFile(requireUser(request).id, id(request));
    // Images show inline; everything else downloads, so an upload can never render as a page here.
    const disposition = row.kind === "image" ? "inline" : "attachment";
    return reply
      .header("content-type", row.mime)
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "private, max-age=86400")
      .header("content-disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(row.name)}`)
      .send(readFileStream(row.storageKey));
  });

  app.delete("/files/:id", async (request, reply) => {
    await deleteFile(requireUser(request).id, id(request));
    return reply.status(204).send();
  });
}
