import { describe, expect, it } from "vitest";
import { deriveFirstStep, deriveSummary, deriveTitle, suggestHeuristic } from "./heuristic.js";

const folders = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Telegram bots", icon: "TelegramLogo" as const },
  { id: "22222222-2222-4222-8222-222222222222", name: "Travel", icon: "Airplane" as const },
];

describe("deriveTitle", () => {
  it("uses the first sentence", () => {
    expect(deriveTitle("A bot for plants. It pings me daily.")).toBe("A bot for plants");
  });

  it("drops lead-ins like 'I want to build'", () => {
    expect(deriveTitle("I want to build a bot that waters plants")).toBe("A bot that waters plants");
    expect(deriveTitle("Idea: weekly meal planner")).toBe("Weekly meal planner");
    expect(deriveTitle("Хочу сделать бота для заметок")).toBe("Бота для заметок");
  });

  it("cuts long titles at a word boundary", () => {
    const title = deriveTitle("word ".repeat(40));
    expect(title.length).toBeLessThanOrEqual(73);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("deriveSummary", () => {
  it("collapses whitespace and clamps", () => {
    expect(deriveSummary("a\n\n  b")).toBe("a b");
    expect(deriveSummary("x".repeat(400)).length).toBe(160);
  });
});

describe("deriveFirstStep", () => {
  it("fits the kind of idea", () => {
    expect(deriveFirstStep("A telegram bot for my shopping list")).toMatch(/BotFather/);
  });

  it("answers in Russian for Russian ideas", () => {
    expect(deriveFirstStep("Игра про грибников")).toMatch(/раунд/);
  });

  it("always offers something to start with", () => {
    expect(deriveFirstStep("zzz qqq").length).toBeGreaterThan(10);
  });
});

describe("suggestHeuristic", () => {
  const base = { examples: [], locale: "en" as const };

  it("prefers an existing folder that matches", () => {
    const s = suggestHeuristic({ ...base, text: "Telegram bot that reminds me to drink water", folders });
    expect(s.primary).toMatchObject({ kind: "existing", name: "Telegram bots" });
  });

  it("learns from previously filed ideas", () => {
    const s = suggestHeuristic({
      ...base,
      text: "Cheap flights tracker for Tbilisi",
      folders,
      examples: [{ title: "Tbilisi itinerary", folderName: "Travel" }],
    });
    expect(s.primary).toMatchObject({ kind: "existing", name: "Travel" });
  });

  it("prefers a clear topic over one word shared with an old idea", () => {
    const s = suggestHeuristic({
      ...base,
      text: "I want an app that plans my weekly meals from what is already in the fridge",
      folders: [{ id: "33333333-3333-4333-8333-333333333333", name: "Health", icon: "Barbell" }],
      examples: [{ title: "Weekly digest of my gym progress", folderName: "Health" }],
    });
    expect(s.primary).toMatchObject({ kind: "new", name: "Apps" });
    expect(s.alternatives.map((a) => a.name)).toEqual(["Food", "Health"]);
  });

  it("proposes a new folder when nothing fits", () => {
    const s = suggestHeuristic({ ...base, text: "A board game about mushrooms", folders });
    expect(s.primary).toMatchObject({ kind: "new", name: "Games", icon: "GameController" });
  });

  it("files Russian ideas into a matching existing folder", () => {
    const s = suggestHeuristic({ ...base, text: "Телеграм бот для учёта расходов", folders });
    expect(s.primary).toMatchObject({ kind: "existing", name: "Telegram bots" });
  });

  it("matches Russian words at word boundaries", () => {
    //  only knows Latin letters; "бот" and "еда" on their own used to never match.
    expect(suggestHeuristic({ ...base, text: "Бот для заметок", folders: [] }).primary).toMatchObject({
      name: "Телеграм-боты",
    });
    expect(suggestHeuristic({ ...base, text: "Еда на неделю из того, что есть", folders: [] }).primary).toMatchObject({
      name: "Еда",
    });
    // ...without matching inside other words: "стать" (to become) isn't an article.
    expect(suggestHeuristic({ ...base, text: "Хочу стать программистом", folders: [] }).primary.name).not.toBe("Тексты");
  });

  it("names new folders and first steps in the idea's language", () => {
    const s = suggestHeuristic({ ...base, text: "Приготовить ужин из того, что лежит в холодильнике", folders: [] });
    expect(s.primary).toMatchObject({ kind: "new", name: "Еда", icon: "ForkKnife" });
    expect(s.firstStep).toMatch(/рецепт/);
  });

  it("uses the account language when the idea has no letters to go on", () => {
    const s = suggestHeuristic({ ...base, locale: "ru", text: "2026 🚀", folders: [] });
    expect(s.primary).toEqual({ kind: "new", name: "Идеи", icon: "Lightning" });
  });

  it("falls back to a generic folder", () => {
    const s = suggestHeuristic({ ...base, text: "zzz qqq", folders: [] });
    expect(s.primary).toEqual({ kind: "new", name: "Ideas", icon: "Lightning" });
    expect(s.source).toBe("heuristic");
  });
});
