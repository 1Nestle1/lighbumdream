import { Bot, GrammyError, InlineKeyboard, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { FastifyBaseLogger } from "fastify";
import { LIMITS, type Idea, type Locale } from "@lightbulb/shared";
import { env } from "../env.js";
import { HttpError } from "../lib/http.js";
import { listFolders } from "../folders/service.js";
import { confirmIdea, createIdea, deleteIdea, getIdea, listIdeas, relatedIdeas, updateIdea } from "../ideas/service.js";
import { addFile, addNote } from "../notebook/service.js";
import { createClip } from "../voice/service.js";
import { normalizeMime } from "../voice/whisper.js";
import { choiceToTarget, findUserByTelegramId, redeemLinkCode, suggestionChoices } from "./service.js";
import { onRunUpdate } from "../agents/signals.js";
import { canLinkToWeb, esc, webLink } from "./format.js";
import { handleRevisionReply, registerRunHandlers, sendRunNotice } from "./runs.js";
import { BOT_STRINGS, localeFromTelegram, type BotStrings } from "./strings.js";

type Download = (filePath: string) => Promise<Buffer>;

export interface BotOptions {
  log: FastifyBaseLogger;
  /** Skips the getMe call (tests). */
  botInfo?: UserFromGetMe;
  /** Replaces the file download from Telegram's servers (tests). */
  download?: Download;
}

/** Resolved once per update: the linked account (if any) and the language to answer in. */
interface Lightbulb {
  account: { id: string; email: string; locale: Locale } | null;
  s: BotStrings;
}
type Ctx = Context & Lightbulb;


/**
 * The idea a message replies to. Every idea card the bot sends carries the idea id in its
 * buttons' callback data, so a reply to any of them identifies the idea without extra storage.
 */
function repliedIdeaId(ctx: Context): string | null {
  const replied = ctx.message?.reply_to_message;
  if (!replied || replied.from?.id !== ctx.me.id) return null;
  for (const button of replied.reply_markup?.inline_keyboard.flat() ?? []) {
    const data = "callback_data" in button ? button.callback_data : "";
    const match = /^(?:f|o|of|b|u|d|dd):([0-9a-f-]{36})/.exec(data ?? "");
    if (match) return match[1]!;
  }
  return null;
}

function ideaCard(s: BotStrings, idea: Idea, extra?: string): string {
  const lines = [`💡 <b>${esc(idea.title)}</b>`];
  if (extra) lines.push(extra);
  if (idea.nextStep) lines.push("", `👣 <b>${s.startWith}</b> ${esc(idea.nextStep)}`);
  return lines.join("\n");
}

async function suggestionKeyboard(s: BotStrings, userId: string, idea: Idea) {
  const folders = await listFolders(userId);
  const kb = new InlineKeyboard();
  suggestionChoices(idea, folders).forEach((choice, i) => {
    const label = `${i === 0 ? "✅ " : ""}${choice.name}${choice.kind === "new" ? s.newSuffix : ""}`;
    kb.text(label, `f:${idea.id}:${i}`);
    if (i === 0) kb.row();
  });
  return kb.row().text(s.otherFolder, `o:${idea.id}`).text(s.delete, `d:${idea.id}`);
}

function filedKeyboard(s: BotStrings, ideaId: string) {
  const kb = new InlineKeyboard().text(s.undo, `u:${ideaId}`);
  return canLinkToWeb ? kb.url(s.open, webLink(ideaId)) : kb;
}

export function createBot(token: string, { log, botInfo, download }: BotOptions): Bot<Ctx> {
  const bot = new Bot<Ctx>(token, botInfo ? { botInfo } : undefined);

  const fetchFile: Download =
    download ??
    (async (filePath) => {
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
      if (!res.ok) throw new Error(`Telegram file download failed: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    });

  // First middleware, so it covers every handler in both polling and webhook mode
  // (bot.catch only applies to polling).
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      const s = ctx.s ?? BOT_STRINGS[localeFromTelegram(ctx.from?.language_code)];
      const friendly =
        err instanceof HttpError && err.code === "voice_unavailable"
          ? s.voiceUnavailable
          : err instanceof HttpError && err.statusCode < 500
            ? (s.errors[err.code] ?? err.message)
            : s.generic;
      if (!(err instanceof HttpError) || err.statusCode >= 500) log.error({ err }, "Telegram handler failed");
      try {
        if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: friendly });
        else await ctx.reply(friendly);
      } catch (replyErr) {
        if (!(replyErr instanceof GrammyError)) throw replyErr;
        // The chat may be gone or the query expired; nothing more to tell the user.
      }
    }
  });

  // Linked chats answer in the account's language; others follow the Telegram app's language.
  bot.use(async (ctx, next) => {
    ctx.account = ctx.from ? await findUserByTelegramId(ctx.from.id) : null;
    ctx.s = BOT_STRINGS[ctx.account?.locale ?? localeFromTelegram(ctx.from?.language_code)];
    await next();
  });

  /** The linked account, or tells the user how to connect and returns null. */
  async function requireAccount(ctx: Ctx) {
    if (!ctx.account) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: ctx.s.connectFirst });
      else await ctx.reply(ctx.s.notLinked, { parse_mode: "HTML" });
    }
    return ctx.account;
  }

  async function capture(ctx: Ctx, userId: string, text: string, clipId?: string) {
    const { s } = ctx;
    const idea = await createIdea(userId, { text, clipId }, log);
    const heard = clipId ? `🎙 <i>${esc(text)}</i>` : undefined;
    const similar = (await relatedIdeas(userId, text, { exclude: idea.id, limit: 1 }))[0];
    const nudge = similar?.duplicate ? `\n\n${s.similar(esc(similar.title))}` : "";
    await ctx.reply(`${ideaCard(s, idea, heard)}${nudge}\n\n<b>${s.fileItIn}</b>`, {
      parse_mode: "HTML",
      reply_markup: await suggestionKeyboard(s, userId, idea),
    });
  }

  bot.command("start", async (ctx) => {
    const code = ctx.match.trim();
    if (code) {
      const linked = await redeemLinkCode(code, ctx.from!.id);
      // Once linked, answer in the account's language rather than the app's.
      const s = linked ? BOT_STRINGS[linked.locale] : ctx.s;
      await ctx.reply(linked ? s.linked(esc(linked.email)) : s.linkExpired, { parse_mode: "HTML" });
      return;
    }
    await ctx.reply(ctx.account ? ctx.s.welcome : ctx.s.notLinked, { parse_mode: "HTML" });
  });

  bot.command("help", (ctx) => ctx.reply(ctx.s.help));

  bot.command("inbox", async (ctx) => {
    const account = await requireAccount(ctx);
    if (!account) return;
    const { ideas } = await listIdeas(account.id, { view: "inbox", limit: 3 });
    if (ideas.length === 0) {
      await ctx.reply(ctx.s.inboxZero);
      return;
    }
    for (const idea of ideas) {
      await ctx.reply(`${ideaCard(ctx.s, idea)}\n\n<b>${ctx.s.fileItIn}</b>`, {
        parse_mode: "HTML",
        reply_markup: await suggestionKeyboard(ctx.s, account.id, idea),
      });
    }
  });

  bot.command("search", async (ctx) => {
    const account = await requireAccount(ctx);
    if (!account) return;
    const q = ctx.match.trim();
    if (!q) {
      await ctx.reply(ctx.s.searchUsage);
      return;
    }
    const ideas = await relatedIdeas(account.id, q, { limit: 5 });
    await ctx.reply(
      ideas.length
        ? ideas.map((i) => `• <b>${esc(i.title)}</b>${i.nextStep ? `\n  ${esc(i.nextStep)}` : ""}`).join("\n")
        : ctx.s.searchNone(esc(q)),
      { parse_mode: "HTML" },
    );
  });

  /** Adds a note or file to the idea being replied to, and confirms with its title. */
  async function addToIdea(ctx: Ctx, userId: string, ideaId: string, add: () => Promise<unknown>) {
    const idea = await getIdea(userId, ideaId);
    await add();
    await ctx.reply(ctx.s.added(esc(idea.title)), { parse_mode: "HTML" });
  }

  async function downloadTelegramFile(ctx: Ctx) {
    const file = await ctx.getFile();
    return fetchFile(file.file_path!);
  }

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    const account = await requireAccount(ctx);
    if (!account) return;
    // A reply to a plan message is a change request for that plan.
    if (await handleRevisionReply(ctx, account, ctx.message.text)) return;
    const ideaId = repliedIdeaId(ctx);
    if (ideaId) {
      const text = ctx.message.text.slice(0, LIMITS.noteChars);
      await addToIdea(ctx, account.id, ideaId, () => addNote(account.id, ideaId, { text }));
      return;
    }
    await capture(ctx, account.id, ctx.message.text.slice(0, LIMITS.bodyChars));
  });

  // Photos and files only make sense on an existing idea: they're attached by replying to one.
  bot.on(["message:photo", "message:document"], async (ctx) => {
    const account = await requireAccount(ctx);
    if (!account) return;
    const ideaId = repliedIdeaId(ctx);
    if (!ideaId) {
      await ctx.reply(ctx.s.replyToAttach);
      return;
    }
    const photo = ctx.message.photo?.at(-1); // largest size
    const doc = ctx.message.document;
    if (((photo ?? doc)?.file_size ?? 0) > LIMITS.fileBytes) {
      await ctx.reply(ctx.s.fileTooBig);
      return;
    }
    const data = await downloadTelegramFile(ctx);
    const upload = photo
      ? { name: `photo-${ctx.message.message_id}.jpg`, mime: "image/jpeg", data }
      : { name: doc!.file_name ?? "file", mime: doc!.mime_type, data };
    await addToIdea(ctx, account.id, ideaId, () => addFile(account.id, ideaId, upload));
  });

  bot.on(["message:voice", "message:audio"], async (ctx) => {
    const account = await requireAccount(ctx);
    if (!account) return;
    const media = ctx.message.voice ?? ctx.message.audio!;
    if ((media.file_size ?? 0) > 12 * 1024 * 1024) {
      await ctx.reply(ctx.s.tooLong);
      return;
    }
    await ctx.replyWithChatAction("typing");
    const audio = await downloadTelegramFile(ctx);
    // Voice notes are always OGG/Opus; audio files carry their own type. Speech is
    // recognised in the account's language, which is what the user set on the site.
    const mime = normalizeMime(media.mime_type) ?? "audio/ogg";
    const { clipId, text } = await createClip(account.id, audio, mime, account.locale);
    const ideaId = repliedIdeaId(ctx);
    if (ideaId) {
      const note = { text: text.slice(0, LIMITS.noteChars), clipId };
      await addToIdea(ctx, account.id, ideaId, () => addNote(account.id, ideaId, note));
      return;
    }
    await capture(ctx, account.id, text.slice(0, LIMITS.bodyChars), clipId);
  });

  // f:<ideaId>:<choice index>  file into one of the suggested folders
  bot.callbackQuery(/^f:([0-9a-f-]{36}):(\d)$/, async (ctx) => {
    const account = await requireAccount(ctx);
    if (!account) return;
    const [, ideaId, index] = ctx.match;
    const idea = await getIdea(account.id, ideaId!);
    const choice = suggestionChoices(idea, await listFolders(account.id))[Number(index)];
    if (!choice) {
      await ctx.answerCallbackQuery({ text: ctx.s.optionGone });
      return;
    }
    const { folder } = await confirmIdea(account.id, idea.id, { target: choiceToTarget(choice) });
    await ctx.editMessageText(`${ideaCard(ctx.s, idea)}\n\n${ctx.s.filedIn(esc(folder.name))}`, {
      parse_mode: "HTML",
      reply_markup: filedKeyboard(ctx.s, idea.id),
    });
    await ctx.answerCallbackQuery({ text: ctx.s.filedToast(folder.name) });
  });

  // o:<ideaId>  show every folder
  bot.callbackQuery(/^o:([0-9a-f-]{36})$/, async (ctx) => {
    const account = await requireAccount(ctx);
    if (!account) return;
    const ideaId = ctx.match[1]!;
    const folders = await listFolders(account.id);
    const kb = new InlineKeyboard();
    folders.slice(0, 30).forEach((f, i) => {
      kb.text(f.name, `of:${ideaId}:${i}`);
      if (i % 2 === 1) kb.row();
    });
    kb.row().text(ctx.s.back, `b:${ideaId}`);
    await ctx.editMessageReplyMarkup({ reply_markup: kb });
    await ctx.answerCallbackQuery(folders.length ? undefined : { text: ctx.s.noFoldersYet });
  });

  // of:<ideaId>:<folder index>  file into a folder from the full list
  bot.callbackQuery(/^of:([0-9a-f-]{36}):(\d+)$/, async (ctx) => {
    const account = await requireAccount(ctx);
    if (!account) return;
    const [, ideaId, index] = ctx.match;
    const folder = (await listFolders(account.id))[Number(index)];
    if (!folder) {
      await ctx.answerCallbackQuery({ text: ctx.s.foldersChanged });
      return;
    }
    const { idea } = await confirmIdea(account.id, ideaId!, { target: { kind: "existing", folderId: folder.id } });
    await ctx.editMessageText(`${ideaCard(ctx.s, idea)}\n\n${ctx.s.filedIn(esc(folder.name))}`, {
      parse_mode: "HTML",
      reply_markup: filedKeyboard(ctx.s, idea.id),
    });
    await ctx.answerCallbackQuery({ text: ctx.s.filedToast(folder.name) });
  });

  // b:<ideaId> back to the suggestions, u:<ideaId> undo filing (back to the inbox)
  bot.callbackQuery(/^([bu]):([0-9a-f-]{36})$/, async (ctx) => {
    const account = await requireAccount(ctx);
    if (!account) return;
    const [, action, ideaId] = ctx.match;
    const idea =
      action === "u"
        ? await updateIdea(account.id, ideaId!, { folderId: null })
        : await getIdea(account.id, ideaId!);
    await ctx.editMessageText(`${ideaCard(ctx.s, idea)}\n\n<b>${ctx.s.fileItIn}</b>`, {
      parse_mode: "HTML",
      reply_markup: await suggestionKeyboard(ctx.s, account.id, idea),
    });
    await ctx.answerCallbackQuery(action === "u" ? { text: ctx.s.backInInbox } : undefined);
  });

  // d:<ideaId> asks, dd:<ideaId> deletes
  bot.callbackQuery(/^d:([0-9a-f-]{36})$/, async (ctx) => {
    const account = await requireAccount(ctx);
    if (!account) return;
    const ideaId = ctx.match[1]!;
    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard().text(ctx.s.confirmDelete, `dd:${ideaId}`).text(ctx.s.keep, `b:${ideaId}`),
    });
    await ctx.answerCallbackQuery({ text: ctx.s.deleteQuestion });
  });

  bot.callbackQuery(/^dd:([0-9a-f-]{36})$/, async (ctx) => {
    const account = await requireAccount(ctx);
    if (!account) return;
    await deleteIdea(account.id, ctx.match[1]!);
    await ctx.editMessageText(ctx.s.deleted);
    await ctx.answerCallbackQuery();
  });

  registerRunHandlers(bot, requireAccount);

  return bot;
}

let running: { bot: Bot<Ctx>; username: string; unsubscribe: () => void } | null = null;

export const telegramInfo = () => ({ enabled: running !== null, botUsername: running?.username ?? null });
export const runningBot = () => running?.bot ?? null;
export const usesWebhook = () => Boolean(env.TELEGRAM_WEBHOOK_URL);

const commandList = (s: BotStrings) => [
  { command: "inbox", description: s.commands.inbox },
  { command: "search", description: s.commands.search },
  { command: "help", description: s.commands.help },
];

/** Starts the bot when a token is configured: webhook if TELEGRAM_WEBHOOK_URL is set, long polling otherwise. */
export async function startTelegram(log: FastifyBaseLogger) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const bot = createBot(env.TELEGRAM_BOT_TOKEN, { log });
  try {
    await bot.init();
    // The command menu follows the Telegram app's language.
    await bot.api.setMyCommands(commandList(BOT_STRINGS.en));
    await bot.api.setMyCommands(commandList(BOT_STRINGS.ru), { language_code: "ru" });
    if (env.TELEGRAM_WEBHOOK_URL) {
      await bot.api.setWebhook(`${env.TELEGRAM_WEBHOOK_URL}/api/telegram/webhook`, {
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      });
    } else {
      await bot.api.deleteWebhook();
      void bot.start({ drop_pending_updates: false });
    }
    // Tell users when an agent needs them: options or a plan to pick, a finished or failed build.
    const unsubscribe = onRunUpdate((runId) => sendRunNotice(bot, runId, log));
    running = { bot, username: bot.botInfo.username, unsubscribe };
    log.info({ bot: bot.botInfo.username, mode: usesWebhook() ? "webhook" : "polling" }, "Telegram bot started");
  } catch (err) {
    log.error({ err }, "Telegram bot failed to start; continuing without it");
  }
}

export async function stopTelegram() {
  running?.unsubscribe();
  if (running && !usesWebhook()) await running.bot.stop();
  running = null;
}
