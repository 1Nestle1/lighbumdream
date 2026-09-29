import { and, eq, isNull, lt } from "drizzle-orm";
import type { Locale, TranscribeResponse } from "@lightbulb/shared";
import { db, type Tx } from "../db/client.js";
import { audioClips, ideas } from "../db/schema.js";
import { HttpError, notFound } from "../lib/http.js";
import { transcribe } from "./whisper.js";

export const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

/** Transcribes a recording and keeps it, unattached, until an idea claims it. */
export async function createClip(
  userId: string,
  audio: Buffer,
  mime: string,
  language: Locale,
): Promise<TranscribeResponse> {
  const text = await transcribe(audio, mime, language);
  if (!text) throw new HttpError(422, "no_speech", "Didn't catch any words. Try again a bit closer to the mic.");
  const [clip] = await db
    .insert(audioClips)
    .values({ userId, mime, data: audio, sizeBytes: audio.length, transcript: text })
    .returning({ id: audioClips.id });
  return { clipId: clip!.id, text };
}

/** Attaches an uploaded clip to a new idea. Only the owner's unattached clips qualify. */
export async function attachClip(tx: Tx, userId: string, clipId: string, ideaId: string) {
  const [clip] = await tx
    .update(audioClips)
    .set({ ideaId })
    .where(
      and(eq(audioClips.id, clipId), eq(audioClips.userId, userId), isNull(audioClips.ideaId), isNull(audioClips.noteId)),
    )
    .returning({ id: audioClips.id });
  if (!clip) throw new HttpError(400, "invalid_clip", "That recording is no longer available");
  await tx.update(ideas).set({ hasAudio: true }).where(eq(ideas.id, ideaId));
}

export async function getIdeaAudio(userId: string, ideaId: string) {
  const [clip] = await db
    .select({ mime: audioClips.mime, data: audioClips.data })
    .from(audioClips)
    .where(and(eq(audioClips.ideaId, ideaId), eq(audioClips.userId, userId)))
    .limit(1);
  if (!clip) throw notFound("Recording");
  return clip;
}

/** Recordings that never became an idea or a note are dropped after a day. */
export async function deleteOrphanClips() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db
    .delete(audioClips)
    .where(and(isNull(audioClips.ideaId), isNull(audioClips.noteId), lt(audioClips.createdAt, cutoff)));
}
