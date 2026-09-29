import type { Locale } from "@lightbulb/shared";
import { env } from "../env.js";
import { HttpError } from "../lib/http.js";

const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
};

/** "audio/webm;codecs=opus" -> "audio/webm", or null if we don't accept it. */
export function normalizeMime(mime: string | undefined): string | null {
  const base = (mime ?? "").split(";")[0]!.trim().toLowerCase();
  return base in EXTENSIONS ? base : null;
}

/** Whisper marks silence and noise like "[BLANK_AUDIO]" or "(music)"; those aren't words. */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Transcribes with the self-hosted whisper.cpp server, which converts any format
 * with ffmpeg (--convert). The language is always passed explicitly: auto-detection
 * guesses wrong on short clips and then writes Russian speech in Latin letters.
 */
export async function transcribe(audio: Buffer, mime: string, language: Locale): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `audio.${EXTENSIONS[mime] ?? "bin"}`);
  form.append("language", language);
  form.append("response_format", "json");
  form.append("temperature", "0.0");

  let res: Response;
  try {
    res = await fetch(`${env.WHISPER_URL}/inference`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new HttpError(503, "voice_unavailable", "Voice transcription isn't running right now");
  }
  if (!res.ok) throw new HttpError(502, "transcription_failed", "Couldn't transcribe that recording");

  const data = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
  if (!data || data.error) throw new HttpError(502, "transcription_failed", "Couldn't transcribe that recording");
  return cleanTranscript(data.text ?? "");
}

let lastCheck = { at: 0, ok: false };

/** Cheap reachability check for the health endpoint, cached for 30 seconds. */
export async function voiceAvailable(): Promise<boolean> {
  if (Date.now() - lastCheck.at < 30_000) return lastCheck.ok;
  const ok = await fetch(env.WHISPER_URL, { signal: AbortSignal.timeout(1500) })
    .then((r) => r.ok)
    .catch(() => false);
  lastCheck = { at: Date.now(), ok };
  return ok;
}
