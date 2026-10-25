import { env } from "../env.js";

/** Escapes text for Telegram's HTML parse mode. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

export const webLink = (ideaId: string) => `${env.WEB_ORIGIN}/ideas/${ideaId}`;

// Telegram rejects URL buttons that point at localhost, so only offer them for real deployments.
export const canLinkToWeb = env.WEB_ORIGIN.startsWith("https://");
