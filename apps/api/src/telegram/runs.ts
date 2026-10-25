import { InlineKeyboard, type Bot, type Context } from "grammy";
import type { FastifyBaseLogger } from "fastify";
import { approveRun, chooseOption, retryRun, reviseRun, runForNotice } from "../agents/runs.js";
import { HttpError } from "../lib/http.js";
import { addStep } from "../notebook/service.js";
import { canLinkToWeb, clip, esc, webLink } from "./format.js";
import { BOT_STRINGS, type BotStrings } from "./strings.js";

// Agent runs in Telegram: when an agent finishes a stage, the bot tells the owner it's their
// turn, with buttons to pick an option, approve the plan, retry, or add the next steps.
// Callback data (max 64 bytes):
//   rc:<runId>:<option>   choose an option        ra:<runId>:<planVersion>  approve that plan
//   rx:<runId>            ask what should change  rr:<runId>                retry a failed stage
//   rf:<runId>            add the result's next steps to the idea's checklist
// A text reply to a plan message (or to the "what should change" prompt) becomes the change request.

type Notice = NonNullable<Awaited<ReturnType<typeof runForNotice>>>;
const TELEGRAM_LIMIT = 3900;

/** Change requests typed as a reply to the bot's "what should change" prompt: chat:message -> run. */
const revisionPrompts = new Map<string, { runId: string; expires: number }>();

function openButton(kb: InlineKeyboard, s: BotStrings, ideaId: string) {
  return canLinkToWeb ? kb.row().url(s.open, webLink(ideaId)) : kb;
}

/** The message for a run's current state, or null when it isn't the user's turn. */
export function runMessage(s: BotStrings, notice: Notice): { text: string; keyboard: InlineKeyboard } | null {
  const { run } = notice;
  const idea = esc(notice.ideaTitle);
  const kb = new InlineKeyboard();

  if (run.status === "options_ready" && run.options) {
    const lines = [s.runOptions(idea), ""];
    run.options.forEach((option, i) => {
      lines.push(`${i + 1}. <b>${esc(option.title)}</b> (${s.effort[option.effort] ?? option.effort})`);
      lines.push(esc(clip(option.summary, 260)), "");
      kb.text(clip(`${i + 1}. ${option.title}`, 60), `rc:${run.id}:${i}`).row();
    });
    return { text: clip(lines.join("\n").trim(), TELEGRAM_LIMIT), keyboard: openButton(kb, s, run.ideaId) };
  }

  if (run.status === "plan_ready" && run.plan) {
    const { plan } = run;
    const lines = [s.runPlan(idea), "", `<b>${esc(plan.title)}</b>`, esc(clip(plan.summary, 600)), "", `<b>${s.planSteps}</b>`];
    plan.steps.forEach((step, i) => lines.push(`${i + 1}. ${esc(clip(step.title, 160))}`));
    const needs = [...plan.risks, ...plan.questions];
    if (needs.length) lines.push("", `<b>${s.planNeeds}</b>`, ...needs.map((item) => `• ${esc(clip(item, 200))}`));
    lines.push("", `<i>${s.planReply}</i>`);
    kb.text(s.approve, `ra:${run.id}:${run.planVersion}`).row().text(s.requestChanges, `rx:${run.id}`);
    return { text: clip(lines.join("\n"), TELEGRAM_LIMIT), keyboard: openButton(kb, s, run.ideaId) };
  }

  if (run.status === "done" && run.result) {
    const { result } = run;
    const lines = [s.runDone(idea), "", esc(clip(result.summary, 1500))];
    if (result.location) lines.push("", s.runLocation(esc(result.location)));
    if (result.files.length) lines.push("", s.runFiles(result.files.length));
    if (result.followUps.length) {
      lines.push("", `<b>${s.followUps}</b>`, ...result.followUps.map((step) => `• ${esc(step)}`));
      kb.text(s.addFollowUps, `rf:${run.id}`);
    }
    return { text: clip(lines.join("\n"), TELEGRAM_LIMIT), keyboard: openButton(kb, s, run.ideaId) };
  }

  if (run.status === "failed" && run.error) {
    const canRetry = run.target === "cloud" || run.runnerId !== null;
    if (canRetry) kb.text(s.retry, `rr:${run.id}`);
    return {
      text: clip(s.runFailed(idea, esc(run.error.message)), TELEGRAM_LIMIT),
      keyboard: openButton(kb, s, run.ideaId),
    };
  }

  return null;
}

/** Sends the owner a message when it's their turn on a run. Quietly skips unlinked accounts. */
export async function sendRunNotice(bot: Bot<any>, runId: string, log: FastifyBaseLogger) {
  const notice = await runForNotice(runId);
  if (!notice?.telegramId) return;
  const message = runMessage(BOT_STRINGS[notice.locale], notice);
  if (!message) return;
  try {
    await bot.api.sendMessage(notice.telegramId, message.text, { parse_mode: "HTML", reply_markup: message.keyboard });
  } catch (err) {
    log.warn({ err, runId }, "Couldn't send a run update to Telegram");
  }
}

/** The run a text message is a change request for: a reply to a plan message or to the prompt. */
export function revisionTarget(ctx: Context): string | null {
  const replied = ctx.message?.reply_to_message;
  if (!replied || replied.from?.id !== ctx.me.id) return null;
  const key = `${replied.chat.id}:${replied.message_id}`;
  const prompt = revisionPrompts.get(key);
  if (prompt && prompt.expires > Date.now()) return prompt.runId;
  for (const button of replied.reply_markup?.inline_keyboard.flat() ?? []) {
    const data = "callback_data" in button ? (button.callback_data ?? "") : "";
    const match = /^r[ax]:([0-9a-f-]{36})/.exec(data);
    if (match) return match[1]!;
  }
  return null;
}

type Account = { id: string };
type RunCtx = Context & { s: BotStrings; account: Account | null };

/** Button and reply handlers for runs. `requireAccount` answers unlinked chats. */
export function registerRunHandlers<C extends RunCtx>(bot: Bot<C>, requireAccount: (ctx: C) => Promise<Account | null>) {
  /** Clears the buttons of the message that was acted on, so it can't be pressed twice. */
  const settle = (ctx: C) => ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

  bot.callbackQuery(/^rc:([0-9a-f-]{36}):(\d)$/, async (ctx) => {
    const account = await requireAccount(ctx);
    if (!account) return;
    const run = await chooseOption(account.id, ctx.match[1]!, { index: Number(ctx.match[2]) });
    await settle(ctx);
    await ctx.answerCallbackQuery();
    await ctx.reply(ctx.s.chose(esc(run.choice?.title ?? "")), { parse_mode: "HTML" });
  });

  bot.callbackQuery(/^ra:([0-9a-f-]{36}):(\d+)$/, async (ctx) => {
    const account = await requireAccount(ctx);
    if (!account) return;
    await approveRun(account.id, ctx.match[1]!, Number(ctx.match[2]));
    await settle(ctx);
    await ctx.answerCallbackQuery();
    await ctx.reply(ctx.s.approved);
  });

  bot.callbackQuery(/^rx:([0-9a-f-]{36})$/, async (ctx) => {
    const account = await requireAccount(ctx);
    if (!account) return;
    const runId = ctx.match[1]!;
    const notice = await runForNotice(runId);
    await ctx.answerCallbackQuery();
    const prompt = await ctx.reply(ctx.s.whatToChange(esc(notice?.ideaTitle ?? "")), {
      parse_mode: "HTML",
      reply_markup: { force_reply: true, input_field_placeholder: ctx.s.requestChanges },
    });
    revisionPrompts.set(`${prompt.chat.id}:${prompt.message_id}`, { runId, expires: Date.now() + 24 * 60 * 60 * 1000 });
  });

  bot.callbackQuery(/^rr:([0-9a-f-]{36})$/, async (ctx) => {
    const account = await requireAccount(ctx);
    if (!account) return;
    await retryRun(account.id, ctx.match[1]!);
    await settle(ctx);
    await ctx.answerCallbackQuery();
    await ctx.reply(ctx.s.retrying);
  });

  bot.callbackQuery(/^rf:([0-9a-f-]{36})$/, async (ctx) => {
    const account = await requireAccount(ctx);
    if (!account) return;
    const notice = await runForNotice(ctx.match[1]!);
    if (!notice || notice.run.userId !== account.id || !notice.run.result) {
      throw new HttpError(404, "not_found", "Run not found");
    }
    let added = 0;
    for (const step of notice.run.result.followUps) {
      try {
        await addStep(account.id, notice.run.ideaId, step);
        added += 1;
      } catch (err) {
        if (err instanceof HttpError && err.code === "limit_reached") break;
        throw err;
      }
    }
    await settle(ctx);
    await ctx.answerCallbackQuery({ text: ctx.s.followUpsAdded(added) });
  });
}

/** Turns a reply into a change request for the plan; true when it handled the message. */
export async function handleRevisionReply(ctx: RunCtx, account: Account, text: string): Promise<boolean> {
  const runId = revisionTarget(ctx);
  if (!runId) return false;
  await reviseRun(account.id, runId, text.slice(0, 1000));
  await ctx.reply(ctx.s.revising);
  return true;
}

// Forget old prompts now and then.
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of revisionPrompts) if (value.expires < now) revisionPrompts.delete(key);
}, 60 * 60 * 1000).unref();
