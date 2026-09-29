import { describe, expect, it } from "vitest";
import { AgentOptionsOutput, AgentPlanSchema, AgentResultOutput, UserCodeSchema } from "@lightbulb/shared";
import { projectSlug } from "./slug.js";
import { parseJsonLoose } from "@lightbulb/shared/protocol";

const ID = "3f9a1c2e-0000-4000-8000-000000000000";

describe("projectSlug", () => {
  it("transliterates Russian titles", () => {
    expect(projectSlug("Бот для заметок", ID)).toBe("bot-dlya-zametok-3f9a1c");
  });

  it("keeps ASCII readable and short", () => {
    const slug = projectSlug("A Telegram bot that tracks my gym sessions & sends reminders!", ID);
    expect(slug).toMatch(/^[a-z0-9-]+-3f9a1c$/);
    expect(slug.length).toBeLessThanOrEqual(47);
  });

  it("falls back when nothing is left", () => {
    expect(projectSlug("✨✨", ID)).toBe("idea-3f9a1c");
  });
});

describe("UserCodeSchema", () => {
  it("normalises what people type", () => {
    expect(UserCodeSchema.parse(" bcdf ghjk ")).toBe("BCDF-GHJK");
    expect(UserCodeSchema.parse("bcdf-ghjk")).toBe("BCDF-GHJK");
  });

  it("rejects anything else", () => {
    expect(UserCodeSchema.safeParse("BCDF-GHJ").success).toBe(false);
  });
});

describe("agent answers", () => {
  const option = { title: "Bot", summary: "A bot", approach: "", effort: "small", stack: [], tradeoff: "" };

  it("clamps long fields instead of failing", () => {
    const parsed = AgentOptionsOutput.parse({
      options: [{ ...option, title: "x".repeat(200) }, option, option, option, option],
    });
    expect(parsed.options).toHaveLength(4);
    expect(parsed.options[0]!.title.length).toBe(80);
  });

  it("tolerates a wrong effort and missing lists", () => {
    const parsed = AgentOptionsOutput.parse({ options: [{ ...option, effort: "huge", stack: "n/a" }, option] });
    expect(parsed.options[0]!.effort).toBe("medium");
    expect(parsed.options[0]!.stack).toEqual([]);
  });

  it("needs at least two options and one plan step", () => {
    expect(AgentOptionsOutput.safeParse({ options: [option] }).success).toBe(false);
    expect(AgentPlanSchema.safeParse({ title: "Plan", summary: "Do it", steps: [] }).success).toBe(false);
  });

  it("parses JSON wrapped in prose", () => {
    const text = 'Done!\n```json\n{"summary":"Built it","followUps":["Deploy"]}\n```';
    expect(AgentResultOutput.parse(parseJsonLoose(text))).toEqual({ summary: "Built it", followUps: ["Deploy"] });
    expect(parseJsonLoose("no json here")).toBe("no json here");
  });
});
