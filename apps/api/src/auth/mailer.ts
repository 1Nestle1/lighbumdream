import nodemailer from "nodemailer";
import type { FastifyBaseLogger } from "fastify";
import type { Locale } from "@lightbulb/shared";
import { env } from "../env.js";

const transport = env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : null;

export const mailerConfigured = transport !== null;

const COPY: Record<Locale, { subject: string; intro: string; button: string; note: string }> = {
  en: {
    subject: "Your Lightbulb sign-in link",
    intro: "Sign in to Lightbulb:",
    button: "Open your idea bank",
    note: "The link works once and expires in 15 minutes.",
  },
  ru: {
    subject: "Ссылка для входа в Lightbulb",
    intro: "Вход в Lightbulb:",
    button: "Открыть банк идей",
    note: "Ссылка одноразовая и действует 15 минут.",
  },
};

/** Sends the sign-in link. Without SMTP configured, the link is logged instead. */
export async function sendMagicLink(email: string, link: string, locale: Locale, log: FastifyBaseLogger) {
  if (!transport) {
    log.info({ email, link }, "Magic link (no SMTP configured)");
    return;
  }
  const copy = COPY[locale];
  await transport.sendMail({
    from: env.MAIL_FROM,
    to: email,
    subject: copy.subject,
    text: `${copy.intro}\n\n${link}\n\n${copy.note}`,
    html: `<p>${copy.intro}</p><p><a href="${link}">${copy.button}</a></p><p style="color:#666">${copy.note}</p>`,
  });
}
