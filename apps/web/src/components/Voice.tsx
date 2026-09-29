import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MicrophoneIcon, StopIcon } from "@phosphor-icons/react";
import type { Locale } from "@lightbulb/shared";
import { useI18n } from "../i18n";
import { api } from "../lib/api";
import { cn } from "../lib/format";
import { canRecord, useRecorder } from "../lib/recorder";
import { LanguageToggle } from "./LocaleSwitch";

const SPEECH_KEY = "lb-speech-lang";

function readSpeechLanguage(): Locale | null {
  try {
    const value = localStorage.getItem(SPEECH_KEY);
    return value === "en" || value === "ru" ? value : null;
  } catch {
    return null;
  }
}

/**
 * The language you speak in. It follows the interface language until you pick one
 * explicitly while recording; that choice is remembered on this device.
 */
function useSpeechLanguage() {
  const { locale } = useI18n();
  const [chosen, setChosen] = useState<Locale | null>(readSpeechLanguage);
  const choose = (next: Locale) => {
    setChosen(next);
    try {
      localStorage.setItem(SPEECH_KEY, next);
    } catch {
      // Not remembered across visits, but still used for this recording.
    }
  };
  return [chosen ?? locale, choose] as const;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Record, then transcribe on our own server. `onText` receives the transcript and the id
 * of the stored recording, which can be attached to whatever gets saved.
 */
export function useVoiceInput(onText: (text: string, clipId: string) => void) {
  const { errorText } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [speechLanguage, setSpeechLanguage] = useSpeechLanguage();
  const levelRef = useRef<HTMLDivElement>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const transcribe = useMutation({
    mutationFn: api.transcribe,
    onSuccess: ({ clipId, text }) => onTextRef.current(text, clipId),
    onError: (err) => setError(errorText(err)),
  });

  const recorder = useRecorder({
    levelTarget: levelRef,
    onRecorded: (audio) => {
      setError(null);
      transcribe.mutate({ audio, language: speechLanguage });
    },
  });

  const toggle = () => {
    setError(null);
    recorder.clearError();
    if (recorder.state === "recording") recorder.stop();
    else if (recorder.state === "idle") void recorder.start();
  };

  return {
    recorder,
    transcribe,
    error,
    speechLanguage,
    setSpeechLanguage,
    levelRef,
    toggle,
    /** Recording or transcribing: nothing should be saved yet. */
    busy: transcribe.isPending || recorder.state !== "idle",
  };
}

export type VoiceInput = ReturnType<typeof useVoiceInput>;

export function MicButton({ voice, size = "md" }: { voice: VoiceInput; size?: "md" | "lg" }) {
  const { m } = useI18n();
  if (!canRecord()) return null;
  const recording = voice.recorder.state === "recording";
  const dims = size === "lg" ? "h-12 w-12" : "h-10 w-10";
  const label = recording ? m.voice.stop : m.voice.record;
  return (
    <button
      type="button"
      onClick={voice.toggle}
      disabled={voice.transcribe.isPending || voice.recorder.state === "requesting"}
      aria-label={label}
      title={label}
      aria-pressed={recording}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-200 active:scale-[0.97] disabled:opacity-50",
        dims,
        recording ? "bg-accent text-on-accent" : "bg-sunken text-ink-soft hover:bg-line hover:text-ink",
      )}
    >
      {recording && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-accent/45 transition-transform duration-75"
          style={{ transform: "scale(calc(1 + var(--level, 0) * 0.7))" }}
        />
      )}
      <span className="relative">
        {recording ? <StopIcon size={18} weight="fill" /> : <MicrophoneIcon size={size === "lg" ? 20 : 18} />}
      </span>
    </button>
  );
}

/** Listening strip while recording, then a transcribing row, then any error. */
export function VoiceStatus({ voice }: { voice: VoiceInput }) {
  const { m } = useI18n();
  const { recorder, transcribe } = voice;
  const error = voice.error ?? (recorder.error ? m.voice.errors[recorder.error] : null);
  if (recorder.state === "recording") {
    return (
      <div className="mt-3 flex items-center gap-2.5 rounded-field bg-accent-soft/80 px-3.5 py-2 sm:gap-3" aria-live="polite">
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-ink/60 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent-ink" />
        </span>
        <span className="text-sm font-medium text-ink">{m.voice.listening}</span>
        <span className="font-mono text-xs text-ink-soft">{clock(recorder.elapsed)}</span>
        <span className="flex h-6 min-w-6 flex-1 items-center gap-[3px] overflow-hidden" aria-hidden>
          {[0.5, 0.9, 1.3, 0.8, 1.1, 0.6, 1.2, 0.7, 1, 0.55].map((k, i) => (
            <span
              key={i}
              className="h-full w-[3px] shrink-0 origin-center rounded-full bg-accent-ink/70 transition-transform duration-75"
              style={{ transform: `scaleY(calc(0.15 + var(--level, 0) * ${k}))` }}
            />
          ))}
        </span>
        {/* Transcription uses this after you stop, so it can still be changed mid-sentence. */}
        <LanguageToggle size="sm" value={voice.speechLanguage} onChange={voice.setSpeechLanguage} label={m.voice.language} />
        <button
          type="button"
          onClick={recorder.cancel}
          className="rounded-full px-2 py-1 text-xs font-medium text-ink-soft hover:bg-panel hover:text-ink"
        >
          {m.common.cancel}
        </button>
      </div>
    );
  }
  if (transcribe.isPending) {
    return (
      <div className="mt-3 flex items-center gap-3 rounded-field bg-sunken px-3.5 py-2.5" aria-live="polite">
        <span className="text-sm text-ink-soft">{m.voice.transcribing}</span>
        <span className="shimmer h-2 flex-1 rounded-full" aria-hidden />
      </div>
    );
  }
  if (error) {
    return (
      <p className="mt-3 text-[13px] text-danger" role="alert">
        {error}
      </p>
    );
  }
  return null;
}
