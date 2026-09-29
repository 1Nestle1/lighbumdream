import { describe, expect, it } from "vitest";
import { cleanTranscript, normalizeMime } from "./whisper.js";

describe("normalizeMime", () => {
  it("strips codec parameters", () => {
    expect(normalizeMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(normalizeMime("Audio/OGG; codecs=opus")).toBe("audio/ogg");
  });

  it("rejects non-audio types", () => {
    expect(normalizeMime("application/pdf")).toBeNull();
    expect(normalizeMime(undefined)).toBeNull();
  });
});

describe("cleanTranscript", () => {
  it("drops whisper's noise markers", () => {
    expect(cleanTranscript(" [BLANK_AUDIO] ")).toBe("");
    expect(cleanTranscript("(music) A bot for plants [ Silence ]")).toBe("A bot for plants");
  });

  it("collapses whitespace", () => {
    expect(cleanTranscript("  one\n two   three ")).toBe("one two three");
  });
});
