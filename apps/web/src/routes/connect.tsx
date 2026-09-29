import { useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DesktopTowerIcon, SealCheckIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { useI18n } from "../i18n";
import { api } from "../lib/api";
import { keys } from "../lib/queries";
import { Button, inputClass } from "../components/ui";

/** Remembers a pairing code across sign-in (the magic link may open in a new tab). */
export const PENDING_CONNECT_KEY = "lb-pending-connect";

export function rememberPendingConnect(code: string | null) {
  try {
    if (code) localStorage.setItem(PENDING_CONNECT_KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    // The user can type the code again.
  }
}

/** A code remembered in the last 10 minutes, cleared once read. */
export function takePendingConnect(): string | null {
  try {
    const raw = localStorage.getItem(PENDING_CONNECT_KEY);
    localStorage.removeItem(PENDING_CONNECT_KEY);
    const saved = raw ? (JSON.parse(raw) as { code: string; at: number }) : null;
    return saved && Date.now() - saved.at < 10 * 60 * 1000 ? saved.code : null;
  } catch {
    return null;
  }
}

/**
 * Approves a computer that ran `lightbulb login`. The terminal shows a code; approving
 * it here gives that computer a token to take this account's ideas.
 */
export function ConnectPage() {
  const { m, fmt, errorText } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const code = params.get("code")?.trim().toUpperCase() ?? "";
  const [typed, setTyped] = useState("");

  const info = useQuery({
    queryKey: ["pairing", code],
    queryFn: () => api.pairing(code),
    enabled: Boolean(code),
    retry: false,
  });
  const approve = useMutation({
    mutationFn: () => api.approvePairing(code),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.agents }),
  });

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    if (typed.trim()) setParams({ code: typed.trim().toUpperCase() });
  };

  return (
    <div className="mx-auto flex max-w-lg flex-col pt-6 md:pt-14">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="relative overflow-hidden rounded-card border border-line bg-panel p-6 shadow-card md:p-8"
      >
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-accent/20 blur-3xl" />

        {approve.isSuccess ? (
          <div className="relative">
            <SealCheckIcon size={36} weight="fill" className="text-accent-ink" aria-hidden />
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">{fmt(m.connect.doneTitle, { name: approve.data.name })}</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{m.connect.doneBody}</p>
            <Button variant="primary" className="mt-6" onClick={() => navigate("/")}>
              {m.connect.back}
            </Button>
          </div>
        ) : !code ? (
          <form onSubmit={submitCode} className="relative">
            <DesktopTowerIcon size={32} weight="duotone" className="text-accent-ink" aria-hidden />
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">{m.connect.enterTitle}</h1>
            <p className="mt-2 text-[15px] text-ink-soft">{m.connect.enterBody}</p>
            <label htmlFor="pair-code" className="mt-5 block text-[13px] font-medium text-ink-soft">
              {m.connect.codeLabel}
            </label>
            <input
              id="pair-code"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              autoComplete="off"
              placeholder="BCDF-GHJK"
              maxLength={12}
              className={`${inputClass} mt-2 font-mono text-lg uppercase tracking-[0.2em]`}
            />
            <Button type="submit" variant="primary" className="mt-4" disabled={!typed.trim()}>
              {m.connect.continue}
            </Button>
          </form>
        ) : info.isPending ? (
          <div className="relative space-y-3" aria-busy="true">
            <div className="shimmer h-8 w-8 rounded-lg" />
            <div className="shimmer h-7 w-2/3 rounded-md" />
            <div className="shimmer h-14 rounded-field" />
          </div>
        ) : info.isError ? (
          <div className="relative" role="alert">
            <h1 className="text-2xl font-semibold tracking-tight">{m.connect.enterTitle}</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-danger">{errorText(info.error)}</p>
            <Button className="mt-5" onClick={() => setParams({})}>
              {m.connect.continue}
            </Button>
          </div>
        ) : (
          <div className="relative">
            <DesktopTowerIcon size={32} weight="duotone" className="text-accent-ink" aria-hidden />
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">{fmt(m.connect.title, { name: info.data.name })}</h1>
            <p className="mt-1 font-mono text-xs text-ink-faint">{info.data.platform}</p>
            <p className="mt-5 rounded-field border border-line bg-sunken py-4 text-center font-mono text-3xl font-semibold tracking-[0.25em] text-ink">
              {info.data.userCode}
            </p>
            <p className="mt-4 flex gap-2 text-[13.5px] leading-relaxed text-ink-soft">
              <ShieldCheckIcon size={18} className="mt-0.5 shrink-0 text-accent-ink" aria-hidden />
              {m.connect.body}
            </p>
            {approve.isError && (
              <p className="mt-3 text-[13px] text-danger" role="alert">
                {errorText(approve.error)}
              </p>
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              <Button variant="primary" size="lg" onClick={() => approve.mutate()} disabled={approve.isPending}>
                {approve.isPending ? m.connect.approving : m.connect.approve}
              </Button>
              <Button size="lg" variant="ghost" onClick={() => navigate("/")}>
                {m.connect.deny}
              </Button>
            </div>
          </div>
        )}
      </motion.div>
      <p className="mt-4 text-center text-[13px] text-ink-faint">
        <Link to="/" className="hover:text-ink-soft">
          Lightbulb
        </Link>
      </p>
    </div>
  );
}
