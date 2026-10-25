import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { ArrowRightIcon, EnvelopeSimpleIcon, WarningIcon } from "@phosphor-icons/react";
import type { FolderIcon } from "@lightbulb/shared";
import { useI18n } from "../i18n";
import { api, ApiError } from "../lib/api";
import { keys, queryClient, useHealth, useMe } from "../lib/queries";
import { takePendingConnect } from "./connect";
import { Brand } from "../components/AppShell";
import { IdeaCard } from "../components/IdeaCard";
import { LocaleSwitch } from "../components/LocaleSwitch";
import { Button, Field, inputClass } from "../components/ui";
import { cn } from "../lib/format";

const HOUR = 3600_000;
// Layout for the example cards; their text comes from the dictionary (login.showcase).
const SHOWCASE_LAYOUT: { icon: FolderIcon | null; ago: number; tilt: string }[] = [
  { icon: "TelegramLogo", ago: 2 * HOUR, tilt: "lg:-rotate-[2.5deg] lg:translate-x-6" },
  { icon: null, ago: 0.2 * HOUR, tilt: "lg:rotate-[1.5deg] lg:-translate-x-4" },
  { icon: "Airplane", ago: 26 * HOUR, tilt: "lg:-rotate-1 lg:translate-x-10" },
  { icon: "Robot", ago: 72 * HOUR, tilt: "lg:rotate-[2deg]" },
];

export function LoginPage() {
  const { m, locale, rich, errorText } = useI18n();
  const me = useMe();
  const health = useHealth();
  const navigate = useNavigate();
  // Password first; the emailed link only where links can actually be delivered.
  const linkAvailable = Boolean(health.data?.auth.magicLink);
  const [mode, setMode] = useState<"password" | "link">("password");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ email: string; devLink?: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  if (me.data) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (mode === "password") {
        const { user } = await api.login(email, password);
        queryClient.setQueryData(keys.me, user);
        const pending = takePendingConnect();
        navigate(pending ? `/connect?code=${encodeURIComponent(pending)}` : "/", { replace: true });
        return;
      }
      // The page's language goes along, so the email and the account match it.
      const res = await api.requestLink(email, locale);
      setSent({ email: email.trim().toLowerCase(), devLink: res.devLink });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const errorMessage = !error
    ? null
    : error instanceof ApiError && error.code === "validation"
      ? m.login.invalidEmail
      : errorText(error);

  return (
    <div className="relative z-10 grid min-h-[100dvh] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <section className="flex flex-col px-5 py-8 sm:px-10 lg:px-16 lg:py-12">
        <div className="flex items-center justify-between gap-4">
          <Brand />
          <LocaleSwitch />
        </div>
        <div className="my-auto w-full max-w-md py-14">
          {sent ? (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
                <EnvelopeSimpleIcon size={28} weight="duotone" aria-hidden />
              </div>
              <h1 className="text-4xl font-semibold leading-[1.05] tracking-tighter">{m.login.checkInbox}</h1>
              <p className="mt-4 text-base leading-relaxed text-ink-soft">
                {rich(m.login.sentTo, { email: <strong className="font-semibold text-ink">{sent.email}</strong> })}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                {sent.devLink && (
                  <Button variant="primary" size="lg" onClick={() => window.location.assign(sent.devLink!)}>
                    {m.login.openDevLink} <ArrowRightIcon size={16} weight="bold" aria-hidden />
                  </Button>
                )}
                <Button variant="ghost" size="lg" onClick={() => setSent(null)}>
                  {m.login.anotherEmail}
                </Button>
              </div>
              {sent.devLink && <p className="mt-4 text-[13px] text-ink-faint">{m.login.devNote}</p>}
            </motion.div>
          ) : (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <h1 className="pb-1 text-4xl font-semibold leading-[1.1] tracking-tighter md:text-5xl">
                {rich(m.login.headline, {
                  em: <em className="font-semibold italic text-accent-ink">{m.login.headlineEm}</em>,
                })}
              </h1>
              <p className="mt-5 max-w-[42ch] text-base leading-relaxed text-ink-soft md:text-lg">{m.login.subtitle}</p>
              <form onSubmit={(e) => void submit(e)} className="mt-9 flex flex-col gap-4">
                <Field
                  label={m.login.email}
                  htmlFor="email"
                  error={mode === "link" ? errorMessage : null}
                  hint={mode === "link" ? m.login.emailHint : undefined}
                >
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={cn(inputClass, "h-12")}
                    placeholder={m.login.placeholder}
                  />
                </Field>
                {mode === "password" && (
                  <Field label={m.login.password} htmlFor="password" error={errorMessage}>
                    <input
                      id="password"
                      type="password"
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={cn(inputClass, "h-12")}
                    />
                  </Field>
                )}
                <Button type="submit" variant="primary" size="lg" disabled={pending} className="w-full sm:w-auto sm:self-start">
                  {mode === "password"
                    ? pending
                      ? m.login.signingIn
                      : m.login.signIn
                    : pending
                      ? m.login.sending
                      : m.login.submit}
                  {!pending && <ArrowRightIcon size={16} weight="bold" aria-hidden />}
                </Button>
              </form>
              {(linkAvailable || mode === "link") && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode(mode === "password" ? "link" : "password");
                  }}
                  className="mt-5 text-sm font-medium text-ink-soft underline-offset-4 transition hover:text-ink hover:underline"
                >
                  {mode === "password" ? m.login.useLink : m.login.usePassword}
                </button>
              )}
            </motion.div>
          )}
        </div>
      </section>

      <section
        aria-label={m.login.examples}
        className="relative hidden overflow-hidden border-l border-line/70 bg-sunken/70 lg:block"
      >
        <div
          aria-hidden
          className="absolute left-1/2 top-1/3 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-accent/30 blur-[110px]"
        />
        <div className="relative mx-auto flex h-full max-w-[520px] flex-col justify-center gap-5 px-10 py-16">
          {m.login.showcase.map((item, i) => {
            const layout = SHOWCASE_LAYOUT[i]!;
            return (
              <motion.div
                key={i}
                className={layout.tilt}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 120, damping: 20, delay: 0.15 + i * 0.09 }}
              >
                <IdeaCard
                  idea={{
                    title: item.title,
                    body: item.body,
                    createdAt: new Date(Date.now() - layout.ago).toISOString(),
                  }}
                  folder={item.folder && layout.icon ? { name: item.folder, icon: layout.icon } : null}
                  className={cn(i === 1 && "border-accent-ink/40")}
                />
              </motion.div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function VerifyPage() {
  const { m, errorText } = useI18n();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token");
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false);

  useEffect(() => {
    // Links are single-use: guard against React StrictMode running the effect twice.
    if (!token || started.current) return;
    started.current = true;
    api
      .verify(token)
      .then(({ user }) => {
        queryClient.setQueryData(keys.me, user);
        const pending = takePendingConnect();
        navigate(pending ? `/connect?code=${encodeURIComponent(pending)}` : "/", { replace: true });
      })
      .catch((err: unknown) => setError(err));
  }, [token, navigate]);

  const errorMessage = !token ? m.verify.missingToken : error ? errorText(error) || m.verify.failed : null;

  return (
    <div className="relative z-10 flex min-h-[100dvh] flex-col items-center justify-center px-5">
      <div className="w-full max-w-sm rounded-card border border-line bg-panel p-7 text-center shadow-float">
        <div className="flex justify-center">
          <Brand />
        </div>
        {errorMessage ? (
          <>
            <p className="mt-7 flex items-center justify-center gap-2 font-medium text-danger">
              <WarningIcon size={18} weight="bold" aria-hidden /> {errorMessage}
            </p>
            <Link to="/login" className="mt-5 inline-block">
              <Button variant="primary" tabIndex={-1}>
                {m.verify.newLink}
              </Button>
            </Link>
          </>
        ) : (
          <div className="mt-7" aria-live="polite">
            <p className="text-sm text-ink-soft">{m.verify.signingIn}</p>
            <div className="shimmer mx-auto mt-4 h-2 w-40 rounded-full" aria-hidden />
          </div>
        )}
      </div>
    </div>
  );
}
