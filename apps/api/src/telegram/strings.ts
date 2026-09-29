import type { Locale } from "@lightbulb/shared";

// Everything the bot says. Messages use Telegram HTML; callers escape the values they pass in.

const en = {
  notLinked:
    "This chat isn't connected to a Lightbulb account yet.\n\nOpen Lightbulb on the web, press <b>Connect Telegram</b> in the sidebar, and follow the link back here.",
  connectFirst: "Connect your account first",
  linked: (email: string) =>
    `Connected to <b>${email}</b>.\n\nSend me an idea as text or a voice message and I'll put it in your bank.`,
  linkExpired: "That link has expired or was already used. Make a new one from the Lightbulb sidebar.",
  welcome: "Send me an idea as text or a voice message. I'll suggest a folder and a first step.",
  help: [
    "Send any text or voice message and it becomes an idea in your bank.",
    "Reply to an idea to add a note, voice note, photo or file.",
    "",
    "/inbox  ideas waiting for a folder",
    "/search <words>  find ideas",
  ].join("\n"),
  inboxZero: "Inbox zero. Every idea has a folder.",
  searchUsage: "Add some words, like /search telegram bot",
  searchNone: (q: string) => `Nothing matches "${q}".`,
  tooLong: "That recording is too long. Keep voice ideas under a few minutes.",
  added: (title: string) => `📎 Added to <b>${title}</b>`,
  replyToAttach: "To attach this, reply to a message with an idea.",
  fileTooBig: "That file is too big. The limit is 20 MB.",
  startWith: "Start with:",
  fileItIn: "File it in:",
  similar: (title: string) => `🔁 Looks like <b>${title}</b>, which you already have.`,
  newSuffix: " (new)",
  otherFolder: "📁 Other folder",
  delete: "🗑 Delete",
  undo: "↩️ Undo",
  open: "Open",
  back: "← Back",
  confirmDelete: "Yes, delete",
  keep: "Keep it",
  filedIn: (folder: string) => `✅ Filed in <b>${folder}</b>`,
  filedToast: (folder: string) => `Filed in ${folder}`,
  optionGone: "That option is gone. Try Other folder.",
  noFoldersYet: "No folders yet. Pick a suggestion.",
  foldersChanged: "Folders changed. Try again.",
  backInInbox: "Back in the inbox",
  deleteQuestion: "Delete this idea for good?",
  deleted: "🗑 Deleted.",
  voiceUnavailable: "Voice isn't available right now. Send the idea as text.",
  generic: "Something went wrong. Try again in a moment.",
  /** Friendly text for API error codes the bot can hit. */
  errors: {
    not_found: "That idea isn't there anymore.",
    no_speech: "Didn't catch any words. Try again a bit closer to the mic.",
    transcription_failed: "Couldn't transcribe that recording. Try again or send text.",
    unsupported_audio: "That audio format isn't supported.",
    invalid_clip: "That recording is no longer available.",
    limit_reached: "This idea is full. Finish or remove something first.",
    unsupported_file: "That file type isn't supported.",
    storage_full: "Your storage is full. Delete some files on the site first.",
  } as Record<string, string>,
  commands: { inbox: "Ideas waiting for a folder", search: "Find ideas", help: "How this works" },
};

export type BotStrings = typeof en;

const ru: BotStrings = {
  notLinked:
    "Этот чат ещё не подключён к аккаунту Lightbulb.\n\nОткрой Lightbulb в браузере, нажми <b>Подключить Telegram</b> в боковой панели и перейди по ссылке обратно сюда.",
  connectFirst: "Сначала подключи аккаунт",
  linked: (email) =>
    `Подключено к <b>${email}</b>.\n\nПришли идею текстом или голосовым, и я положу её в твой банк.`,
  linkExpired: "Ссылка устарела или уже использована. Создай новую в боковой панели Lightbulb.",
  welcome: "Пришли идею текстом или голосовым. Я подскажу папку и первый шаг.",
  help: [
    "Любой текст или голосовое станет идеей в твоём банке.",
    "Ответь на сообщение с идеей, чтобы добавить заметку, голосовое, фото или файл.",
    "",
    "/inbox  идеи, которые ждут папку",
    "/search <слова>  найти идеи",
  ].join("\n"),
  inboxZero: "Входящие пусты. У каждой идеи есть папка.",
  searchUsage: "Добавь слова, например /search телеграм бот",
  searchNone: (q) => `По запросу «${q}» ничего нет.`,
  tooLong: "Запись слишком длинная. Уложи голосовую идею в пару минут.",
  added: (title) => `📎 Добавлено в <b>${title}</b>`,
  replyToAttach: "Чтобы прикрепить это, ответь на сообщение с идеей.",
  fileTooBig: "Файл слишком большой. Лимит 20 МБ.",
  startWith: "Начни с:",
  fileItIn: "Положить в папку:",
  similar: (title) => `🔁 Похоже на <b>${title}</b>, такая идея уже есть.`,
  newSuffix: " (новая)",
  otherFolder: "📁 Другая папка",
  delete: "🗑 Удалить",
  undo: "↩️ Отменить",
  open: "Открыть",
  back: "← Назад",
  confirmDelete: "Да, удалить",
  keep: "Оставить",
  filedIn: (folder) => `✅ Лежит в папке <b>${folder}</b>`,
  filedToast: (folder) => `В папке «${folder}»`,
  optionGone: "Этого варианта уже нет. Выбери другую папку.",
  noFoldersYet: "Папок пока нет. Выбери подсказку.",
  foldersChanged: "Папки изменились. Попробуй ещё раз.",
  backInInbox: "Снова во входящих",
  deleteQuestion: "Удалить идею насовсем?",
  deleted: "🗑 Удалено.",
  voiceUnavailable: "Голос сейчас недоступен. Отправь идею текстом.",
  generic: "Что-то пошло не так. Попробуй чуть позже.",
  errors: {
    not_found: "Этой идеи уже нет.",
    no_speech: "Слов не слышно. Попробуй ещё раз, поближе к микрофону.",
    transcription_failed: "Не удалось распознать запись. Попробуй ещё раз или отправь текстом.",
    unsupported_audio: "Этот аудиоформат не поддерживается.",
    invalid_clip: "Эта запись больше недоступна.",
    limit_reached: "В этой идее уже нет места. Сначала заверши или удали что-нибудь.",
    unsupported_file: "Такой тип файла не поддерживается.",
    storage_full: "Хранилище заполнено. Удали несколько файлов на сайте.",
  },
  commands: { inbox: "Идеи, которые ждут папку", search: "Найти идеи", help: "Как это работает" },
};

export const BOT_STRINGS: Record<Locale, BotStrings> = { en, ru };

/** Unlinked chats follow the Telegram app's language; linked ones follow the account. */
export const localeFromTelegram = (languageCode: string | undefined): Locale =>
  languageCode?.toLowerCase().startsWith("ru") ? "ru" : "en";
