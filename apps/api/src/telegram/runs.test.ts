import { describe, expect, it } from "vitest";
import { runMessage } from "./runs.js";
import { BOT_STRINGS } from "./strings.js";

const RUN_ID = "0b6f4c1e-8d2a-4c3b-9e5f-1a2b3c4d5e6f";
const IDEA_ID = "9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";

// Only the fields runMessage reads; the rest of the row doesn't matter here.
function notice(run: Record<string, unknown>) {
  return {
    ideaTitle: "Gym <digest>",
    telegramId: 1,
    locale: "en" as const,
    runnerName: "PC",
    run: { id: RUN_ID, ideaId: IDEA_ID, target: "local", runnerId: "r", planVersion: 2, ...run },
  } as unknown as Parameters<typeof runMessage>[1];
}

const buttons = (message: ReturnType<typeof runMessage>) =>
  message!.keyboard.inline_keyboard.flat().map((b) => ("callback_data" in b ? b.callback_data : ""));

describe("runMessage", () => {
  const s = BOT_STRINGS.en;

  it("offers one button per option, with ids under Telegram's 64-byte limit", () => {
    const option = { title: "Telegram bot", summary: "A bot", approach: "", effort: "small", stack: [], tradeoff: "" };
    const message = runMessage(s, notice({ status: "options_ready", options: [option, { ...option, title: "Sheet" }] }));
    expect(message!.text).toContain("Gym &lt;digest&gt;");
    expect(message!.text).toContain("(an evening)");
    expect(buttons(message)).toEqual([`rc:${RUN_ID}:0`, `rc:${RUN_ID}:1`]);
    for (const data of buttons(message)) expect(Buffer.byteLength(data!)).toBeLessThanOrEqual(64);
  });

  it("asks to approve the exact plan version", () => {
    const plan = { title: "Bot", summary: "Build it", steps: [{ title: "Init", detail: "" }], deliverables: [], risks: ["Needs a token"], questions: [] };
    const message = runMessage(s, notice({ status: "plan_ready", plan }));
    expect(message!.text).toContain("1. Init");
    expect(message!.text).toContain("• Needs a token");
    expect(buttons(message)).toEqual([`ra:${RUN_ID}:2`, `rx:${RUN_ID}`]);
  });

  it("offers the next steps after a build, and retry after a failure", () => {
    const result = { summary: "Done", followUps: ["Deploy"], location: "C:\\Users\\a\\Lightbulb\\bot", files: [] };
    expect(buttons(runMessage(s, notice({ status: "done", result })))).toEqual([`rf:${RUN_ID}`]);
    const failed = runMessage(s, notice({ status: "failed", error: { stage: "build", message: "Oops", code: "failed" } }));
    expect(buttons(failed)).toEqual([`rr:${RUN_ID}`]);
  });

  it("stays quiet while an agent is working", () => {
    expect(runMessage(s, notice({ status: "building" }))).toBeNull();
  });
});
