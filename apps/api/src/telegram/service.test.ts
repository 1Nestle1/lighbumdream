import { describe, expect, it } from "vitest";
import type { Folder, Idea } from "@lightbulb/shared";
import { suggestionChoices } from "./service.js";

const folder = (id: string, name: string): Folder => ({
  id,
  name,
  icon: "Folder",
  ideaCount: 0,
  createdAt: new Date().toISOString(),
});

const idea = (suggestion: Idea["suggestion"]): Idea => ({
  id: "i1",
  title: "t",
  body: "b",
  status: "inbox",
  folderId: null,
  suggestion,
  nextStep: null,
  hasAudio: false,
  favoriteAt: null,
  projectPath: null,
  archivedAt: null,
  createdAt: "",
  updatedAt: "",
});

describe("suggestionChoices", () => {
  it("turns a deleted suggested folder into a new-folder option", () => {
    const choices = suggestionChoices(
      idea({
        title: "t",
        summary: "s",
        primary: { kind: "existing", folderId: "gone", name: "Bots", icon: "Robot" },
        alternatives: [],
        source: "heuristic",
        createdAt: "",
      }),
      [],
    );
    expect(choices).toEqual([{ kind: "new", name: "Bots", icon: "Robot" }]);
  });

  it("uses a folder created since the suggestion instead of making a duplicate", () => {
    const choices = suggestionChoices(
      idea({
        title: "t",
        summary: "s",
        primary: { kind: "new", name: "games", icon: "GameController" },
        alternatives: [{ kind: "new", name: "Games", icon: "GameController" }],
        source: "heuristic",
        createdAt: "",
      }),
      [folder("f1", "Games")],
    );
    expect(choices).toEqual([{ kind: "existing", folderId: "f1", name: "Games", icon: "Folder" }]);
  });

  it("returns nothing without a suggestion", () => {
    expect(suggestionChoices(idea(null), [])).toEqual([]);
  });
});
