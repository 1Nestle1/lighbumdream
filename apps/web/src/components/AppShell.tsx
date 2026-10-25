import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router";
import {
  ArchiveIcon,
  DesktopIcon,
  LightbulbFilamentIcon,
  LightbulbIcon,
  ListIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  PlugsConnectedIcon,
  RocketLaunchIcon,
  PlusIcon,
  SignOutIcon,
  SquaresFourIcon,
  StackIcon,
  SunIcon,
  TrayIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { User } from "@lightbulb/shared";
import { useI18n } from "../i18n";
import { cn, modKey } from "../lib/format";
import { useFolders, useLogout, useMe } from "../lib/queries";
import { useTheme } from "../lib/theme";
import { OmnibarProvider, useOmnibar } from "./Omnibar";
import { TelegramConnect } from "./TelegramConnect";
import { ComputersNav } from "./Computers";
import { rememberPendingConnect } from "../routes/connect";
import { FolderDialog } from "./FolderDialogs";
import { FolderGlyph } from "./FolderIcon";
import { LocaleSwitch } from "./LocaleSwitch";
import { IconButton, Kbd } from "./ui";

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-accent text-on-accent shadow-[inset_0_1px_0_oklch(1_0_0/0.4),0_6px_18px_-6px_oklch(from_var(--accent)_l_c_h/0.9)]">
        <LightbulbIcon size={20} weight="fill" aria-hidden />
      </span>
      <span className="text-[17px] font-semibold tracking-tight">Lightbulb</span>
    </span>
  );
}

/** Gate for signed-in pages. */
export function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <ShellSkeleton />;
  if (!me.data) {
    // Come back to the pairing page after signing in, even if the magic link opens a new tab.
    if (location.pathname === "/connect") rememberPendingConnect(new URLSearchParams(location.search).get("code"));
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return (
    <OmnibarProvider>
      <AppShell user={me.data} />
    </OmnibarProvider>
  );
}

function AppShell({ user }: { user: User }) {
  const { m } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const { open: openOmnibar } = useOmnibar();

  return (
    <div className="relative z-10 min-h-[100dvh] lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-[100dvh] border-r border-line/70 bg-panel/55 backdrop-blur-xl lg:block">
        <Sidebar user={user} />
      </aside>

      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line/70 bg-canvas/80 px-4 backdrop-blur-xl lg:hidden">
        <Brand />
        <div className="flex items-center gap-1">
          <IconButton label={m.nav.newIdeaOrSearch} onClick={openOmnibar}>
            <MagnifyingGlassIcon size={20} />
          </IconButton>
          <IconButton label={m.nav.menu} onClick={() => setMenuOpen(true)}>
            <ListIcon size={20} />
          </IconButton>
        </div>
      </header>

      <AnimatePresence>
        {menuOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <motion.div
              className="absolute inset-0 bg-[oklch(0.15_0.02_262/0.4)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMenuOpen(false)}
            />
            <motion.aside
              className="absolute inset-y-0 left-0 w-[86%] max-w-[320px] border-r border-line bg-panel shadow-float"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 36 }}
            >
              <IconButton label={m.nav.closeMenu} size="sm" className="absolute right-3 top-4" onClick={() => setMenuOpen(false)}>
                <XIcon size={16} />
              </IconButton>
              <Sidebar user={user} onNavigate={() => setMenuOpen(false)} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <main className="mx-auto w-full max-w-[1320px] px-4 pb-24 pt-6 sm:px-6 lg:px-10 lg:pt-10">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <Outlet />
        </motion.div>
      </main>

    </div>
  );
}

function NavItem({
  to,
  icon,
  label,
  badge,
  highlightBadge = false,
  onNavigate,
  end,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  badge?: number;
  /** Accent badge for counts that ask for action (the inbox). */
  highlightBadge?: boolean;
  onNavigate?: () => void;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group flex h-10 items-center gap-3 rounded-field px-3 text-sm font-medium transition-colors",
          isActive ? "bg-sunken text-ink" : "text-ink-soft hover:bg-sunken/70 hover:text-ink",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span className={cn("transition-colors", isActive ? "text-accent-ink" : "text-ink-faint group-hover:text-ink-soft")}>
            {icon}
          </span>
          <span className="flex-1 truncate">{label}</span>
          {badge !== undefined && badge > 0 && (
            <span
              className={cn(
                "min-w-6 rounded-full px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold",
                highlightBadge ? "bg-accent text-on-accent" : "text-ink-faint",
              )}
            >
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function Sidebar({ user, onNavigate }: { user: User; onNavigate?: () => void }) {
  const { m, fmt } = useI18n();
  const folders = useFolders();
  const { open: openOmnibar } = useOmnibar();
  const logout = useLogout();
  const { pref, cycle } = useTheme();
  const [creating, setCreating] = useState(false);
  const counts = folders.data?.counts;

  const ThemeIcon = pref === "light" ? SunIcon : pref === "dark" ? MoonIcon : DesktopIcon;

  return (
    <div className="flex h-full flex-col px-4 py-5">
      <div className="px-2">
        <Brand />
      </div>

      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          openOmnibar();
        }}
        className="mt-6 flex h-10 items-center gap-2.5 rounded-field border border-line bg-panel px-3 text-sm text-ink-faint transition hover:border-line-strong hover:text-ink-soft"
      >
        <LightbulbFilamentIcon size={16} aria-hidden />
        <span className="flex-1 truncate whitespace-nowrap text-left">{m.nav.addOrSearch}</span>
        <Kbd>{modKey}</Kbd>
        <Kbd>K</Kbd>
      </button>

      <nav className="mt-5 flex flex-col gap-0.5" aria-label={m.nav.bank}>
        <NavItem to="/" end icon={<SquaresFourIcon size={18} />} label={m.nav.bank} onNavigate={onNavigate} />
        <NavItem to="/projects" icon={<RocketLaunchIcon size={18} />} label={m.nav.projects} onNavigate={onNavigate} />
        <NavItem
          to="/inbox"
          icon={<TrayIcon size={18} />}
          label={m.nav.inbox}
          badge={counts?.inbox}
          highlightBadge
          onNavigate={onNavigate}
        />
        <NavItem to="/all" icon={<StackIcon size={18} />} label={m.nav.all} badge={counts?.all} onNavigate={onNavigate} />
        <NavItem to="/archive" icon={<ArchiveIcon size={18} />} label={m.nav.archive} onNavigate={onNavigate} />
      </nav>

      <div className="mt-7 flex items-center justify-between px-3">
        <span className="text-xs font-medium text-ink-faint">{m.nav.folders}</span>
        <IconButton label={m.nav.newFolder} size="sm" className="!h-7 !w-7" onClick={() => setCreating(true)}>
          <PlusIcon size={14} weight="bold" />
        </IconButton>
      </div>
      <nav className="mt-1.5 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" aria-label={m.nav.folders}>
        {folders.isPending &&
          [70, 55, 80].map((w) => (
            <div key={w} className="flex h-10 items-center gap-3 px-3" aria-hidden>
              <div className="shimmer h-4 w-4 rounded" />
              <div className="shimmer h-3.5 rounded" style={{ width: `${w}%` }} />
            </div>
          ))}
        {folders.data?.folders.map((f) => (
          <NavItem
            key={f.id}
            to={`/folders/${f.id}`}
            icon={<FolderGlyph name={f.icon} size={18} />}
            label={f.name}
            badge={f.ideaCount}
            onNavigate={onNavigate}
          />
        ))}
        {folders.data && folders.data.folders.length === 0 && (
          <p className="px-3 py-2 text-[13px] leading-relaxed text-ink-faint">{m.nav.noFolders}</p>
        )}
      </nav>

      <ComputersNav />
      <NavItem
        to="/integrations"
        icon={<PlugsConnectedIcon size={18} />}
        label={m.nav.integrations}
        onNavigate={onNavigate}
      />
      <TelegramConnect />

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-4">
        <LocaleSwitch />
        <IconButton label={fmt(m.nav.theme, { name: m.nav.themes[pref] })} size="sm" onClick={cycle}>
          <ThemeIcon size={16} />
        </IconButton>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sunken font-mono text-xs font-semibold uppercase text-ink-soft">
          {user.email.slice(0, 2)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-soft" title={user.email}>
          {user.email}
        </span>
        <IconButton label={m.nav.signOut} size="sm" onClick={() => logout.mutate()}>
          <SignOutIcon size={16} />
        </IconButton>
      </div>

      <FolderDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="relative z-10 min-h-[100dvh] lg:grid lg:grid-cols-[280px_1fr]" aria-busy="true">
      <div className="hidden border-r border-line/70 p-5 lg:block">
        <div className="shimmer h-9 w-36 rounded-[12px]" />
        <div className="shimmer mt-6 h-10 w-full rounded-field" />
        <div className="mt-5 space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="shimmer h-9 w-full rounded-field" />
          ))}
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1320px] px-4 pt-10 sm:px-6 lg:px-10">
        <div className="shimmer h-9 w-64 rounded-md" />
        <div className="shimmer mt-8 h-40 w-full rounded-[22px]" />
      </div>
    </div>
  );
}
