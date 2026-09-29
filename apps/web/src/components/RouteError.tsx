import { useRouteError } from "react-router";
import { WarningIcon } from "@phosphor-icons/react";
import { useI18n } from "../i18n";
import { Brand } from "./AppShell";
import { Button } from "./ui";

/** Shown instead of a blank page when a route crashes while rendering. */
export function RouteError() {
  const { m } = useI18n();
  const error = useRouteError();
  const message = error instanceof Error ? error.message : m.errors.internal;

  return (
    <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-5">
      <div className="w-full max-w-md rounded-card border border-line bg-panel p-7 shadow-float">
        <Brand />
        <p className="mt-7 flex items-center gap-2 text-lg font-semibold tracking-tight">
          <WarningIcon size={20} weight="bold" className="text-danger" aria-hidden />
          {m.routeError.title}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{m.routeError.body}</p>
        <pre className="mt-4 overflow-x-auto rounded-field bg-sunken p-3 font-mono text-xs text-ink-soft">{message}</pre>
        <div className="mt-6 flex gap-2">
          <Button variant="primary" onClick={() => window.location.reload()}>
            {m.common.reload}
          </Button>
          <Button variant="ghost" onClick={() => window.location.assign("/")}>
            {m.routeError.goBank}
          </Button>
        </div>
      </div>
    </div>
  );
}
