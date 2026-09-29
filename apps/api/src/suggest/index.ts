import type { FastifyBaseLogger } from "fastify";
import type { Suggestion } from "@lightbulb/shared";
import { env } from "../env.js";
import { suggestWithClaude } from "./claude.js";
import { suggestHeuristic } from "./heuristic.js";
import type { SuggestInput } from "./types.js";

export const aiSuggestionsEnabled = Boolean(env.ANTHROPIC_API_KEY);

/** Suggests a title and folder. Never throws: falls back to the offline heuristic. */
export async function suggestFolder(input: SuggestInput, log: FastifyBaseLogger): Promise<Suggestion> {
  const createdAt = new Date().toISOString();
  if (aiSuggestionsEnabled) {
    try {
      return { ...(await suggestWithClaude(input)), createdAt };
    } catch (err) {
      log.warn({ err }, "AI suggestion failed, using heuristic");
    }
  }
  return { ...suggestHeuristic(input), createdAt };
}
