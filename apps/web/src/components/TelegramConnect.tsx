import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TelegramLogoIcon } from "@phosphor-icons/react";
import { useI18n } from "../i18n";
import { api } from "../lib/api";
import { keys, useHealth, useTelegramUnlink } from "../lib/queries";
import { useToast } from "./Toaster";
import { Button } from "./ui";

/** Sidebar control that links this account to the Telegram bot. Hidden when the server has no bot. */
export function TelegramConnect() {
  const { m, rich, errorText } = useI18n();
  const toast = useToast();
  const health = useHealth();
  const enabled = Boolean(health.data?.telegram.enabled);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  const status = useQuery({
    queryKey: keys.telegram,
    queryFn: api.telegramStatus,
    enabled,
    // While the user is off in Telegram pressing Start, check back every few seconds.
    refetchInterval: (query) => (pendingUrl && !query.state.data?.linked ? 3000 : false),
  });
  const unlink = useTelegramUnlink();
  const link = useMutation({ mutationFn: api.telegramLink });

  const linked = Boolean(status.data?.linked);
  useEffect(() => {
    if (linked && pendingUrl) {
      setPendingUrl(null);
      toast({ tone: "success", message: m.telegram.connected });
    }
  }, [linked, pendingUrl, toast, m]);

  // In development, say why there's no Connect button instead of hiding it silently.
  // Deployed sites don't show server setup to their users.
  if (!enabled && health.data && import.meta.env.DEV) {
    return (
      <div className="mt-4 rounded-field border border-dashed border-line-strong p-3.5">
        <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <TelegramLogoIcon size={17} className="text-ink-faint" aria-hidden />
          {m.telegram.notSetUp}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          {rich(m.telegram.notSetUpBody, {
            key: <code className="rounded bg-sunken px-1 font-mono text-[12px] text-ink">TELEGRAM_BOT_TOKEN</code>,
          })}
        </p>
      </div>
    );
  }

  if (!enabled || !status.data) return null;

  const connect = () => {
    // Open the tab during the click so popup blockers allow it, then point it at the link.
    const tab = window.open("about:blank", "_blank");
    link.mutate(undefined, {
      onSuccess: ({ url }) => {
        setPendingUrl(url);
        if (tab) tab.location.href = url;
      },
      onError: (err) => {
        tab?.close();
        toast({ tone: "error", message: errorText(err) });
      },
    });
  };

  if (linked) {
    return (
      <div className="mt-4 flex items-center gap-2.5 rounded-field bg-sunken/70 px-3 py-2.5">
        <TelegramLogoIcon size={18} weight="fill" className="text-accent-ink" aria-hidden />
        <span className="flex-1 text-[13px] text-ink-soft">
          {rich(m.telegram.capturing, {
            bot: <span className="font-medium text-ink">@{status.data.botUsername}</span>,
          })}
        </span>
        <button
          type="button"
          onClick={() => unlink.mutate()}
          className="text-xs font-medium text-ink-faint hover:text-danger"
        >
          {m.telegram.disconnect}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-field border border-line bg-panel/70 p-3.5">
      <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <TelegramLogoIcon size={17} weight="fill" className="text-accent-ink" aria-hidden />
        {m.telegram.title}
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{m.telegram.body}</p>
      {pendingUrl ? (
        <p className="mt-2.5 text-[13px] text-ink-soft">
          {rich(m.telegram.pressStart, {
            start: <strong className="font-semibold">{m.telegram.startButton}</strong>,
          })}{" "}
          <a href={pendingUrl} target="_blank" rel="noreferrer" className="font-medium text-accent-ink underline">
            {m.telegram.openAgain}
          </a>
        </p>
      ) : (
        <Button size="sm" className="mt-3 w-full" onClick={connect} disabled={link.isPending}>
          {link.isPending ? m.telegram.opening : m.telegram.connect}
        </Button>
      )}
    </div>
  );
}
