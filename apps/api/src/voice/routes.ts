import type { FastifyInstance, FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { z } from "zod";
import { TranscribeQuery } from "@lightbulb/shared";
import { requireUser } from "../auth/session.js";
import { HttpError } from "../lib/http.js";
import { createClip, getIdeaAudio, MAX_AUDIO_BYTES } from "./service.js";
import { normalizeMime } from "./whisper.js";

const Params = z.object({ id: z.uuid() });

export async function voiceRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 0 } });

  app.post(
    "/voice/transcribe",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
          keyGenerator: (request: FastifyRequest) => request.user?.id ?? request.ip,
        },
      },
    },
    async (request) => {
      const user = requireUser(request);
      const { language } = TranscribeQuery.parse(request.query);
      const file = await request.file();
      if (!file) throw new HttpError(400, "no_audio", "Attach a recording as the `file` field");
      const mime = normalizeMime(file.mimetype);
      if (!mime) throw new HttpError(415, "unsupported_audio", "That audio format isn't supported");
      const audio = await file.toBuffer(); // throws 413 past MAX_AUDIO_BYTES
      if (audio.length < 1000) throw new HttpError(422, "no_speech", "That recording is too short");
      return createClip(user.id, audio, mime, language ?? user.locale);
    },
  );

  app.get("/ideas/:id/audio", async (request, reply) => {
    const user = requireUser(request);
    const clip = await getIdeaAudio(user.id, Params.parse(request.params).id);
    return reply
      .header("content-type", clip.mime)
      .header("cache-control", "private, max-age=3600")
      .send(clip.data);
  });
}
