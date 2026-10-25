import { useState, type FormEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { CheckCircleIcon, GithubLogoIcon, PlugsConnectedIcon, SparkleIcon, WarningIcon } from "@phosphor-icons/react";
import type { Integration, IntegrationProvider } from "@lightbulb/shared";
import { useI18n } from "../i18n";
import { cn } from "../lib/format";
import { useAgents, useIntegrationActions, useIntegrations } from "../lib/queries";
import { useToast } from "../components/Toaster";
import { Button, inputClass } from "../components/ui";

const LINKS: Record<IntegrationProvider, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  github: "https://github.com/settings/personal-access-tokens/new",
};

/** Your own accounts: an Anthropic key for cloud agents, a GitHub token for publishing builds. */
export function IntegrationsPage() {
  const { m } = useI18n();
  const integrations = useIntegrations();
  const byProvider = new Map(integrations.data?.integrations.map((i) => [i.provider, i]));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 pt-2 md:pt-6">
      <header>
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tighter md:text-4xl">
          <PlugsConnectedIcon size={30} weight="duotone" className="text-accent-ink" aria-hidden />
          {m.integrations.title}
        </h1>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-ink-soft">{m.integrations.intro}</p>
      </header>

      {integrations.data && !integrations.data.available && (
        <p role="alert" className="flex gap-2 rounded-field border border-accent-ink/30 bg-accent-soft/60 px-4 py-3 text-sm text-ink">
          <WarningIcon size={18} weight="bold" className="mt-0.5 shrink-0 text-accent-ink" aria-hidden />
          {m.integrations.unavailable}
        </p>
      )}

      {integrations.isPending ? (
        <div className="space-y-4" aria-hidden>
          <div className="shimmer h-56 rounded-card" />
          <div className="shimmer h-56 rounded-card" />
        </div>
      ) : (
        <>
          <ProviderCard
            provider="anthropic"
            icon={<SparkleIcon size={22} weight="fill" aria-hidden />}
            integration={byProvider.get("anthropic")}
            disabled={!integrations.data?.available}
          />
          <ProviderCard
            provider="github"
            icon={<GithubLogoIcon size={22} weight="fill" aria-hidden />}
            integration={byProvider.get("github")}
            disabled={!integrations.data?.available}
          />
        </>
      )}
    </div>
  );
}

function ProviderCard({
  provider,
  icon,
  integration,
  disabled,
}: {
  provider: IntegrationProvider;
  icon: ReactNode;
  integration: Integration | undefined;
  disabled: boolean;
}) {
  const { m, fmt, rich, timeAgo, errorText } = useI18n();
  const toast = useToast();
  const agents = useAgents();
  const actions = useIntegrationActions();
  const [secret, setSecret] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = m.integrations[provider];
  const fieldId = `secret-${provider}`;
  const showForm = !integration || editing;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    actions.connect.mutate(
      { provider, secret: secret.trim() },
      {
        onSuccess: () => {
          setSecret("");
          setEditing(false);
          toast({ tone: "success", message: m.integrations.saved });
        },
        onError: (err) => setError(errorText(err)),
      },
    );
  };

  const disconnect = () =>
    actions.disconnect.mutate(provider, {
      onSuccess: () => {
        setConfirming(false);
        toast({ tone: "success", message: m.integrations.disconnected });
      },
      onError: (err) => toast({ tone: "error", message: errorText(err) }),
    });

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
      aria-labelledby={`${provider}-heading`}
      className={cn(
        "rounded-card border bg-panel p-5 shadow-card md:p-7",
        integration ? "border-accent-ink/30" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-start gap-4">
        <span
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
            integration ? "bg-accent text-on-accent" : "bg-sunken text-ink-soft",
          )}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id={`${provider}-heading`} className="text-lg font-semibold tracking-tight">
              {copy.name}
            </h2>
            {integration ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-ink">
                <CheckCircleIcon size={13} weight="fill" aria-hidden />
                {fmt(m.integrations.connectedAs, { label: integration.label })}
              </span>
            ) : (
              <span className="rounded-full bg-sunken px-2.5 py-0.5 text-xs font-medium text-ink-soft">
                {m.integrations.notConnected}
              </span>
            )}
          </div>
          <p className="mt-1.5 max-w-[60ch] text-sm leading-relaxed text-ink-soft">{copy.body}</p>
          {integration && (
            <p className="mt-1 text-[13px] text-ink-faint">
              {integration.lastUsedAt ? fmt(m.integrations.lastUsed, { ago: timeAgo(integration.lastUsedAt) }) : m.integrations.neverUsed}
            </p>
          )}
        </div>
        {integration && !editing && (
          <div className="flex items-center gap-2">
            {confirming ? (
              <>
                <span className="text-[13px] text-ink-soft">{m.integrations.disconnectConfirm}</span>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  {m.common.keep}
                </Button>
                <Button size="sm" variant="danger" onClick={disconnect} disabled={actions.disconnect.isPending}>
                  {m.integrations.disconnect}
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" onClick={() => setEditing(true)}>
                  {m.integrations.replace}
                </Button>
                <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
                  {m.integrations.disconnect}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {showForm && (
        <form onSubmit={submit} className="mt-5 border-t border-line pt-5">
          <label htmlFor={fieldId} className="text-[13px] font-medium text-ink-soft">
            {copy.field}
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id={fieldId}
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={copy.placeholder}
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              aria-describedby={`${fieldId}-help`}
              aria-invalid={Boolean(error)}
              className={cn(inputClass, "font-mono text-[14px]")}
            />
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={disabled || secret.trim().length < 10 || actions.connect.isPending}>
                {actions.connect.isPending ? m.integrations.connecting : m.integrations.connect}
              </Button>
              {editing && (
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  {m.common.cancel}
                </Button>
              )}
            </div>
          </div>
          {error ? (
            <p className="mt-2 text-[13px] text-danger" role="alert">
              {error}
            </p>
          ) : (
            <p id={`${fieldId}-help`} className="mt-2 text-[13px] leading-relaxed text-ink-faint">
              {rich(fmt(copy.help, { budget: agents.data?.cloud.budgetUsd ?? 5 }), {
                link: (
                  <a href={LINKS[provider]} target="_blank" rel="noreferrer" className="font-medium text-accent-ink underline">
                    {copy.linkText}
                  </a>
                ),
              })}
            </p>
          )}
        </form>
      )}
    </motion.section>
  );
}
