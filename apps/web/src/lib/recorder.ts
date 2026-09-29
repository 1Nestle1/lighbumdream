import { useEffect, useRef, useState, type RefObject } from "react";

export type RecorderState = "idle" | "requesting" | "recording";
/** Why recording couldn't start; the UI turns these into messages in the current language. */
export type RecorderError = "unsupported" | "blocked" | "noDevice";

const MAX_MS = 3 * 60 * 1000;
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];

const pickMime = () =>
  MIME_CANDIDATES.find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) ?? "";

export const canRecord = () =>
  typeof window !== "undefined" &&
  typeof MediaRecorder !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia);

interface Session {
  recorder: MediaRecorder;
  stream: MediaStream;
  audio: AudioContext;
  raf: number;
  timer: number;
  cancelled: boolean;
}

/**
 * Records from the microphone. The input level is written to `--level` (0..1) on
 * `levelTarget` every frame, straight to the DOM so React doesn't re-render per frame.
 * Recording stops by itself after three minutes.
 */
export function useRecorder({
  onRecorded,
  levelTarget,
}: {
  onRecorded: (audio: Blob) => void;
  levelTarget?: RefObject<HTMLElement | null>;
}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<RecorderError | null>(null);
  const session = useRef<Session | null>(null);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  const teardown = (s: Session) => {
    cancelAnimationFrame(s.raf);
    window.clearInterval(s.timer);
    s.stream.getTracks().forEach((t) => t.stop());
    void s.audio.close().catch(() => {});
    levelTarget?.current?.style.setProperty("--level", "0");
  };

  const stop = () => {
    const s = session.current;
    if (s && s.recorder.state !== "inactive") s.recorder.stop();
  };

  const cancel = () => {
    if (session.current) session.current.cancelled = true;
    stop();
  };

  const start = async () => {
    if (session.current) return;
    setError(null);
    if (!canRecord()) {
      setError("unsupported");
      return;
    }
    setState("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      setState("idle");
      setError(err instanceof DOMException && err.name === "NotAllowedError" ? "blocked" : "noDevice");
      return;
    }

    const mime = pickMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 512;
    audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);

    const s: Session = { recorder, stream, audio, raf: 0, timer: 0, cancelled: false };
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += ((v - 128) / 128) ** 2;
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 5);
      levelTarget?.current?.style.setProperty("--level", level.toFixed(3));
      s.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);

    const startedAt = Date.now();
    setElapsed(0);
    s.timer = window.setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(Math.floor(ms / 1000));
      if (ms >= MAX_MS) stop();
    }, 250);

    recorder.onstop = () => {
      teardown(s);
      session.current = null;
      setState("idle");
      if (!s.cancelled && chunks.length) {
        onRecordedRef.current(new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" }));
      }
    };

    session.current = s;
    recorder.start(250);
    setState("recording");
  };

  // Release the microphone if the component goes away mid-recording.
  useEffect(
    () => () => {
      if (session.current) {
        session.current.cancelled = true;
        if (session.current.recorder.state !== "inactive") session.current.recorder.stop();
      }
    },
    [],
  );

  return { state, elapsed, error, start, stop, cancel, clearError: () => setError(null) };
}
