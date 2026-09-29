import type { FolderChoice, FolderIcon, Locale } from "@lightbulb/shared";
import { tokenize } from "../lib/text.js";
import type { SuggestInput, SuggestionDraft } from "./types.js";

interface Topic {
  // Unicode-aware: \b only understands Latin letters, so Cyrillic words use (?<!\p{L}) instead.
  pattern: RegExp;
  names: Record<Locale, string>;
  icon: FolderIcon;
  /** A first step that fits most ideas of this kind. */
  step: Record<Locale, string>;
}

/** Keyword → folder name, icon and first step, used when nothing existing fits. */
const TOPICS: Topic[] = [
  {
    pattern: /telegram|телеграм|\bbots?\b|(?<!\p{L})бот/iu,
    names: { en: "Telegram bots", ru: "Телеграм-боты" },
    icon: "TelegramLogo",
    step: {
      en: "Create the bot with @BotFather and write down the 3 commands it needs.",
      ru: "Создай бота через @BotFather и запиши 3 команды, которые ему нужны.",
    },
  },
  {
    pattern: /\bai\b|agent|llm|gpt|claude|нейросет|агент|(?<!\p{L})ии(?!\p{L})/iu,
    names: { en: "AI & agents", ru: "ИИ и агенты" },
    icon: "Robot",
    step: {
      en: "Try the core prompt by hand in a chat and save the best result.",
      ru: "Попробуй главный промпт вручную в чате и сохрани лучший результат.",
    },
  },
  {
    pattern: /\bapps?\b|mobile|\bios\b|android|приложени/iu,
    names: { en: "Apps", ru: "Приложения" },
    icon: "DeviceMobile",
    step: {
      en: "Sketch the main screen on paper and list what's on it.",
      ru: "Нарисуй главный экран на бумаге и перечисли, что на нём.",
    },
  },
  {
    pattern: /website|\bsite\b|landing|\bweb\b|сайт|лендинг|(?<!\p{L})веб/iu,
    names: { en: "Web", ru: "Веб" },
    icon: "Globe",
    step: {
      en: "Write the one-sentence headline the page would open with.",
      ru: "Напиши одно предложение, с которого начнётся страница.",
    },
  },
  {
    pattern: /script|\bcli\b|automat|parser|скрипт|автоматиз|парсер|инструмент/iu,
    names: { en: "Dev tools", ru: "Инструменты" },
    icon: "Code",
    step: {
      en: "Write down the exact input and the output you expect for one real case.",
      ru: "Запиши точный вход и ожидаемый результат для одного реального случая.",
    },
  },
  {
    pattern: /startup|business|money|\bsell|\bshop\b|бизнес|деньг|продава|магазин|стартап/iu,
    names: { en: "Business", ru: "Бизнес" },
    icon: "Briefcase",
    step: {
      en: "Name three people who would pay for this and message one of them.",
      ru: "Назови трёх людей, которые заплатили бы за это, и напиши одному из них.",
    },
  },
  {
    pattern: /\bgames?\b|gaming|(?<!\p{L})игр/iu,
    names: { en: "Games", ru: "Игры" },
    icon: "GameController",
    step: {
      en: "Describe one round of play in five sentences.",
      ru: "Опиши один раунд игры в пяти предложениях.",
    },
  },
  {
    pattern: /\bgym\b|workout|fitness|health|\brun(ning)?\b|спорт|трениров|здоров|(?<!\p{L})зал(?!\p{L})/iu,
    names: { en: "Health", ru: "Здоровье" },
    icon: "Barbell",
    step: {
      en: "Decide what you'd track and log it once today by hand.",
      ru: "Реши, что будешь отслеживать, и сегодня запиши это один раз вручную.",
    },
  },
  {
    pattern:
      /recipe|food|cook|meal|fridge|grocer|dinner|lunch|рецепт|(?<!\p{L})еда|(?<!\p{L})еду(?!\p{L})|приготов|готовк|кухн|холодильн|(?<!\p{L})ужин|(?<!\p{L})обед|завтрак/iu,
    names: { en: "Food", ru: "Еда" },
    icon: "ForkKnife",
    step: {
      en: "Write down the first three recipes it should handle.",
      ru: "Запиши первые три рецепта, с которыми это должно работать.",
    },
  },
  {
    pattern: /music|\bsongs?\b|музык|(?<!\p{L})песн/iu,
    names: { en: "Music", ru: "Музыка" },
    icon: "MusicNotes",
    step: {
      en: "Record a 30-second rough version on your phone.",
      ru: "Запиши на телефон черновую версию на 30 секунд.",
    },
  },
  {
    pattern: /travel|\btrips?\b|flight|путешеств|поездк|перелёт|перелет|отпуск/iu,
    names: { en: "Travel", ru: "Путешествия" },
    icon: "Airplane",
    step: {
      en: "Pick the dates and one place you'd book first.",
      ru: "Выбери даты и одно место, которое забронируешь первым.",
    },
  },
  {
    pattern: /\bhome\b|\bhouse\b|garden|\bplants?\b|(?<!\p{L})дом(?!ен)|(?<!\p{L})сад|растени|полив/iu,
    names: { en: "Home", ru: "Дом" },
    icon: "House",
    step: {
      en: "List what you'd need to buy and check one price.",
      ru: "Составь список покупок и проверь одну цену.",
    },
  },
  {
    pattern: /learn|course|study|school|учеб|учёб|курс|изуч|обучени/iu,
    names: { en: "Learning", ru: "Обучение" },
    icon: "GraduationCap",
    step: {
      en: "Find one good resource and do the first 15 minutes of it.",
      ru: "Найди один хороший источник и пройди первые 15 минут.",
    },
  },
  {
    pattern: /photo|video|camera|фото|видео|медиа/iu,
    names: { en: "Media", ru: "Медиа" },
    icon: "Camera",
    step: {
      en: "Collect three examples you like in one folder.",
      ru: "Собери в одну папку три примера, которые тебе нравятся.",
    },
  },
  {
    pattern: /\bwrite\b|\bbooks?\b|\bblog|\bstory|книг|блог|(?<!\p{L})стат(ья|ьи|ью|ей)(?!\p{L})|(?<!\p{L})текст/iu,
    names: { en: "Writing", ru: "Тексты" },
    icon: "BookOpen",
    step: {
      en: "Write the title and a five-line outline.",
      ru: "Напиши заголовок и план из пяти строк.",
    },
  },
];

const DEFAULT_STEP: Topic["step"] = {
  en: "Write down who it's for and the smallest version you could try this week.",
  ru: "Запиши, для кого это и какую самую маленькую версию можно попробовать на этой неделе.",
};
const DEFAULT_FOLDER: Topic["names"] = { en: "Ideas", ru: "Идеи" };

/** Answer in the language the idea is written in; the account language breaks ties. */
export function languageOf(text: string, fallback: Locale = "en"): Locale {
  if (/[а-яё]/i.test(text)) return "ru";
  if (/[a-z]/i.test(text)) return "en";
  return fallback;
}

export function deriveFirstStep(text: string, fallback: Locale = "en"): string {
  const step = TOPICS.find((tp) => tp.pattern.test(text))?.step ?? DEFAULT_STEP;
  return step[languageOf(text, fallback)];
}

/** Loose match so "bots" hits "bot" and "приложение" hits "приложения". */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const stem = Math.min(a.length, b.length, 6);
  return stem >= 4 && a.slice(0, stem) === b.slice(0, stem);
}

/** "I want to build a…", "Idea: …", "Хочу сделать…" add nothing to a title. */
const LEAD_IN =
  /^(?:idea\s*:\s*|идея\s*:\s*|i\s+(?:want|would like|'d like|wanna|need)(?:\s+to(?:\s+(?:make|build|create|have|do))?)?\s+|хочу(?:\s+(?:сделать|создать))?\s+)/i;

export function deriveTitle(text: string, max = 72): string {
  const firstLine = text.trim().split(/\r?\n/)[0] ?? "";
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine;
  const full = sentence.replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
  const stripped = full.replace(LEAD_IN, "");
  const clean = stripped.length >= 3 ? stripped : full;
  if (clean.length <= max) return capitalize(clean);
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return capitalize((lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trim()) + "…";
}

export function deriveSummary(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1).trimEnd() + "…";
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function suggestHeuristic(input: SuggestInput): SuggestionDraft {
  const lang = languageOf(input.text, input.locale);
  const ideaTokens = tokenize(input.text);
  const topics = TOPICS.filter((tp) => tp.pattern.test(input.text));

  const scored = input.folders
    .map((folder) => {
      const nameTokens = tokenize(folder.name);
      const exampleTokens = input.examples
        .filter((e) => e.folderName.toLowerCase() === folder.name.toLowerCase())
        .flatMap((e) => tokenize(e.title));
      let score = 0;
      for (const t of ideaTokens) {
        if (nameTokens.some((n) => wordsMatch(t, n))) score += 3;
        if (exampleTokens.some((n) => wordsMatch(t, n))) score += 1;
      }
      // Topic keywords count too, so "telegram" lands in an existing "Bots" folder.
      if (topics.some((tp) => tp.pattern.test(folder.name))) score += 2;
      return { folder, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const toChoice = ({ folder }: (typeof scored)[number]): FolderChoice => ({
    kind: "existing",
    folderId: folder.id,
    name: folder.name,
    icon: folder.icon,
  });

  // New-folder suggestions for topics no existing folder already covers, in the idea's language.
  const taken = new Set(input.folders.map((f) => f.name.toLowerCase()));
  const fresh: FolderChoice[] = topics
    .filter(
      (tp) =>
        !input.folders.some((f) => tp.pattern.test(f.name)) &&
        !Object.values(tp.names).some((n) => taken.has(n.toLowerCase())),
    )
    .map((tp) => ({ kind: "new", name: tp.names[lang], icon: tp.icon }));

  // A folder name or topic match is real evidence; one word shared with an old idea is not,
  // so a clear topic outranks it.
  const strong = scored.filter((s) => s.score >= 2).map(toChoice);
  const weak = scored.filter((s) => s.score < 2).map(toChoice);
  const ranked = [...strong, ...fresh, ...weak];
  const primary: FolderChoice = ranked[0] ?? { kind: "new", name: DEFAULT_FOLDER[lang], icon: "Lightning" };

  return {
    title: deriveTitle(input.text),
    summary: deriveSummary(input.text),
    primary,
    alternatives: ranked.slice(1, 3),
    firstStep: (topics[0]?.step ?? DEFAULT_STEP)[lang],
    source: "heuristic",
  };
}
