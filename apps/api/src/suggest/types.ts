import type { FolderIcon, Locale, Suggestion } from "@lightbulb/shared";

export interface SuggestInput {
  text: string;
  folders: { id: string; name: string; icon: FolderIcon }[];
  /** Recently confirmed ideas, so suggestions follow how this user files things. */
  examples: { title: string; folderName: string }[];
  /** The account's interface language: a tie-breaker when the idea's own language is unclear. */
  locale: Locale;
}

export type SuggestionDraft = Omit<Suggestion, "createdAt">;
