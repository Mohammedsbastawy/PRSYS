"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { Avatar, Icon, StatusBadge, timeAgo } from "@/components/ui";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  anyOf?: string[];
}

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: "grid_view" },
      {
        href: "/requests",
        label: "Requests",
        icon: "receipt_long",
        anyOf: ["REQUEST_VIEW_ALL", "REQUEST_VIEW_OWN", "REQUEST_CREATE"],
      },
      { href: "/approvals", label: "Approvals", icon: "rule", anyOf: ["REQUEST_APPROVE"] },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/users", label: "Users", icon: "group", anyOf: ["USER_VIEW", "USER_CREATE", "USER_EDIT", "USER_DELETE"] },
      { href: "/departments", label: "Departments", icon: "domain", anyOf: ["DEP_VIEW", "DEP_MANAGE"] },
      { href: "/groups", label: "Groups", icon: "hub", anyOf: ["GROUP_MANAGE"] },
      { href: "/forms", label: "Forms", icon: "dynamic_form", anyOf: ["FORM_TEMPLATE_VIEW", "FORM_TEMPLATE_MANAGE"] },
      { href: "/workflows", label: "Workflows", icon: "alt_route", anyOf: ["WF_VIEW", "WF_MANAGE"] },
      { href: "/sla", label: "SLA Policies", icon: "timer", anyOf: ["SLA_MANAGE"] },
    ],
  },
  {
    title: "Insights",
    items: [{ href: "/reports", label: "Reports", icon: "query_stats", anyOf: ["REPORT_VIEW"] }],
  },
];

interface SearchHit {
  RequestID: string;
  TrackingNumber: string;
  Title: string | null;
  Status: string;
  FormTemplate: { Name: string };
}

interface Notif {
  NotificationID: string;
  Title: string;
  Message: string;
  Type: string;
  RelatedRequestID: string | null;
  IsRead: boolean;
  CreatedAt: string;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, token, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!loading && !token) router.push("/login");
  }, [loading, token, router]);

  // Close popups on navigation
  useEffect(() => {
    setSearchOpen(false);
    setBellOpen(false);
    setMenuOpen(false);
    setMobileNavOpen(false);
    setQuery("");
  }, [pathname]);

  async function loadNotifs() {
    if (!token) return;
    try {
      const r = await fetch("/api/notifications", { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) {
        const d = await r.json();
        setNotifs(d.items || []);
        setUnread(d.unreadCount || 0);
      }
    } catch {
      /* offline — ignore */
    }
  }

  async function loadPending() {
    if (!token) return;
    try {
      const r = await fetch("/api/approvals?mode=pending&countOnly=1", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPendingCount(r.ok ? (await r.json()).count || 0 : 0);
    } catch {
      setPendingCount(0);
    }
  }

  useEffect(() => {
    if (!token) return;
    loadNotifs();
    loadPending();
    const t = setInterval(() => {
      loadNotifs();
      loadPending();
    }, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Debounced global search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.trim().length < 2 || !token) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) setHits(await r.json());
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, token]);

  async function markRead(ids: string[] | "all", goTo?: string | null) {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(ids === "all" ? { all: true } : { ids }),
      });
      loadNotifs();
    } catch {
      /* ignore */
    }
    setBellOpen(false);
    if (goTo) router.push(`/requests/${goTo}`);
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-on-surface-variant">
        <span className="flex items-center gap-2">
          <Icon name="progress_activity" className="animate-spin text-[22px]" /> Loading...
        </span>
      </div>
    );
  }
  if (!token) return null;

  const can = (p: string) => user?.permissions?.includes(p) ?? false;
  const isSuper = user?.role.code === "SUPER_ADMIN";
  const visibleSections = NAV_SECTIONS.map((s) => ({
    ...s,
    items: s.items
      .filter(
        (n) =>
          !n.anyOf ||
          n.anyOf.some((p) => can(p)) ||
          isSuper ||
          // department managers (assignment, not role) see their approval queue
          (n.href === "/approvals" && pendingCount > 0)
      )
      .map((n) => (n.href === "/requests" && !can("REQUEST_VIEW_ALL") ? { ...n, label: "My Requests" } : n)),
  })).filter((s) => s.items.length > 0);
  const canCreate = isSuper || can("REQUEST_CREATE");
  const anyOpen = searchOpen || bellOpen || menuOpen;

  function isActive(n: NavItem) {
    if (n.href === "/") return pathname === "/";
    if (n.href === "/requests")
      return pathname === "/requests" || (pathname.startsWith("/requests/") && !pathname.startsWith("/requests/new"));
    if (n.href === "/approvals") return pathname.startsWith("/approvals");
    return pathname.startsWith(n.href);
  }

  function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
    return (
      <>
        {visibleSections.map((s) => (
          <div key={s.title}>
            <div className="nav-section">{s.title}</div>
            {s.items.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={onNavigate}
                className={`nav-item ${isActive(n) ? "nav-item-active" : ""}`}
              >
                <span className="flex items-center gap-space-sm">
                  <Icon name={n.icon} className="text-[20px]" />
                  <span className="font-body-md text-body-md">{n.label}</span>
                </span>
                {n.href === "/approvals" && pendingCount > 0 && (
                  <span className="rounded-full bg-secondary-container px-2 py-0.5 font-label-sm text-label-sm font-bold text-on-secondary-container">
                    {pendingCount > 99 ? "99+" : pendingCount}
                  </span>
                )}
              </Link>
            ))}
          </div>
        ))}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-surface-container-low">
      {/* ================= Sidebar (desktop) ================= */}
      <aside className="fixed left-0 top-0 z-50 hidden h-screen w-[260px] flex-col justify-between overflow-y-auto bg-surface-container-low shadow-[0_1px_8px_rgba(0,0,0,0.04)] lg:flex">
        <div className="flex flex-col">
          {/* Brand */}
          <div className="flex h-16 items-center justify-between px-space-lg">
            <div className="flex items-center gap-space-sm">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-on-primary">
                <Icon name="token" className="text-[20px]" />
              </div>
              <div className="flex flex-col">
                <span className="font-headline-sm text-body-md font-bold tracking-tight text-on-surface">PRSYS</span>
                <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">Procurement OS</span>
              </div>
            </div>
            <span className="rounded-full bg-secondary-fixed px-1.5 py-0.5 font-label-sm text-label-sm font-semibold text-on-secondary-fixed">
              v2
            </span>
          </div>

          {/* New Request CTA */}
          {canCreate && (
            <div className="px-space-md py-space-sm">
              <Link
                href="/requests/new"
                className="flex w-full items-center justify-center gap-space-sm rounded-lg bg-primary px-space-md py-2 font-headline-sm text-body-md text-on-primary shadow-cta transition-all hover:bg-primary-light"
              >
                <Icon name="add" className="text-[18px]" />
                <span>New Request</span>
              </Link>
            </div>
          )}

          <nav className="mt-space-xs flex flex-col space-y-1 px-space-sm pb-space-sm">
            <NavLinks />
          </nav>
        </div>

        {/* Bottom: help + user card */}
        <div className="mt-space-md flex flex-col gap-space-xs p-space-sm">
          <Link href="/help" className="nav-item">
            <span className="flex items-center gap-space-sm">
              <Icon name="help_outline" className="text-[20px]" />
              <span className="font-body-md text-body-md">Help &amp; Guides</span>
            </span>
          </Link>
          <div className="mt-space-xs flex items-center justify-between rounded-xl bg-surface-container p-space-sm">
            <div className="flex min-w-0 items-center gap-space-sm">
              <Avatar name={user?.name || "?"} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-headline-sm text-body-sm font-semibold text-on-surface">{user?.name}</span>
                <span className="truncate font-label-sm text-label-sm text-outline">{user?.role.name}</span>
              </div>
            </div>
            <button onClick={logout} className="shrink-0 p-1 text-on-surface-variant transition-colors hover:text-primary" title="Sign out">
              <Icon name="logout" className="text-[20px]" />
            </button>
          </div>
        </div>
      </aside>

      {/* ================= Mobile top bar ================= */}
      <div className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-surface-variant bg-surface-container-lowest px-4 lg:hidden">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-on-primary">
            <Icon name="token" className="text-[18px]" />
          </div>
          <span className="font-headline-sm text-body-md font-bold text-on-surface">PRSYS</span>
        </Link>
        <div className="flex items-center gap-1">
          <button className="icon-btn" onClick={() => setMobileNavOpen(!mobileNavOpen)} aria-label="Menu">
            <Icon name={mobileNavOpen ? "close" : "menu"} />
          </button>
          <Avatar name={user?.name || "?"} size="sm" />
        </div>
      </div>
      {mobileNavOpen && (
        <div className="fixed inset-x-0 top-14 z-40 max-h-[70vh] overflow-y-auto border-b border-surface-variant bg-surface-container-lowest p-3 shadow-tier2 lg:hidden">
          {canCreate && (
            <Link
              href="/requests/new"
              className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white"
              onClick={() => setMobileNavOpen(false)}
            >
              <Icon name="add" className="text-[18px]" /> New Request
            </Link>
          )}
          <NavLinks onNavigate={() => setMobileNavOpen(false)} />
          <button onClick={logout} className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-danger">
            <Icon name="logout" className="text-[18px]" /> Sign out
          </button>
        </div>
      )}

      <div className="lg:pl-[260px]">
        {/* ================= Topbar ================= */}
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-3 bg-surface-container-low/80 px-4 shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl lg:px-space-lg">
          {/* Global search */}
          <div className="relative hidden w-96 md:block">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline">
              <Icon name="search" className="text-[18px]" />
            </span>
            <input
              className="h-10 w-full rounded-lg bg-surface-container-lowest pl-9 pr-12 font-body-sm text-body-sm text-on-surface shadow-tier1 outline-none placeholder:text-outline"
              placeholder="Search requests, items, people..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setSearchOpen(false);
                  router.push("/requests");
                }
                if (e.key === "Escape") setSearchOpen(false);
              }}
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded bg-surface-container-high px-1.5 py-0.5 font-label-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
              ⌘K
            </span>
            {searchOpen && query.trim().length >= 2 && (
              <div className="dropdown w-full">
                {searching ? (
                  <div className="px-4 py-3 text-sm text-on-surface-variant">Searching...</div>
                ) : hits.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-on-surface-variant">No matching requests</div>
                ) : (
                  <div className="max-h-80 overflow-y-auto py-1">
                    {hits.map((h) => (
                      <Link
                        key={h.RequestID}
                        href={`/requests/${h.RequestID}`}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-container-low"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-label-md text-label-md font-semibold text-primary">
                            {h.TrackingNumber}
                          </span>
                          <span className="block truncate text-xs text-on-surface-variant">{h.Title || h.FormTemplate?.Name}</span>
                        </span>
                        <StatusBadge status={h.Status} />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="md:hidden" />

          <div className="flex items-center gap-space-md">
            <Link
              href="/help"
              className="hidden rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface md:block"
              aria-label="Help"
            >
              <Icon name="contact_support" className="text-[20px]" />
            </Link>

            {/* Bell */}
            <div className="relative">
              <button
                className="relative rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                aria-label="Notifications"
                onClick={() => {
                  setBellOpen(!bellOpen);
                  setMenuOpen(false);
                  if (!bellOpen) loadNotifs();
                }}
              >
                <Icon name="notifications" className="text-[20px]" />
                {unread > 0 && (
                  <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary ring-2 ring-surface" />
                )}
              </button>
              {bellOpen && (
                <div className="dropdown w-[380px]">
                  <div className="flex items-center justify-between border-b border-surface-variant px-4 py-2.5">
                    <span className="font-headline-sm text-body-sm font-semibold text-on-surface">Notifications</span>
                    {unread > 0 && (
                      <button className="font-label-md text-label-md font-semibold text-primary hover:underline" onClick={() => markRead("all")}>
                        Mark all as read
                      </button>
                    )}
                  </div>
                  <div className="slim-scroll max-h-96 overflow-y-auto">
                    {notifs.length === 0 && (
                      <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
                        <Icon name="notifications_off" className="text-[28px] text-outline" />
                        <div className="text-sm font-medium text-on-surface">You&apos;re all caught up</div>
                        <div className="text-xs text-on-surface-variant">New updates will appear here</div>
                      </div>
                    )}
                    {notifs.map((n) => (
                      <button
                        key={n.NotificationID}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-container-low ${n.IsRead ? "" : "bg-surface-container-low/60"}`}
                        onClick={() => markRead([n.NotificationID], n.RelatedRequestID)}
                      >
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.IsRead ? "bg-surface-container-highest" : "bg-primary"}`} />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-on-surface">{n.Title}</span>
                          <span className="block truncate text-xs text-on-surface-variant">{n.Message}</span>
                          <span className="block font-label-sm text-label-sm text-outline">{timeAgo(n.CreatedAt)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="h-6 w-px bg-surface-dim" />

            {/* User chip */}
            <div className="relative">
              <button
                className="flex items-center gap-space-sm pl-1"
                onClick={() => {
                  setMenuOpen(!menuOpen);
                  setBellOpen(false);
                }}
              >
                <Avatar name={user?.name || "?"} />
                <span className="hidden flex-col text-left md:flex">
                  <span className="font-headline-sm text-body-sm font-semibold leading-tight text-on-surface">{user?.name}</span>
                  <span className="font-label-sm text-label-sm uppercase text-outline">{user?.role.name}</span>
                </span>
                <Icon name="expand_more" className="hidden text-[18px] text-outline md:block" />
              </button>
              {menuOpen && (
                <div className="dropdown w-64">
                  <div className="flex items-center gap-3 border-b border-surface-variant px-4 py-3">
                    <Avatar name={user?.name || "?"} size="lg" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-on-surface">{user?.name}</div>
                      <div className="truncate text-xs text-on-surface-variant">{user?.email}</div>
                      <span className="badge mt-1 bg-secondary-fixed text-on-secondary-fixed">{user?.role.name}</span>
                    </div>
                  </div>
                  <div className="p-2">
                    <button
                      onClick={logout}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-error hover:bg-error-container/50"
                    >
                      <Icon name="logout" className="text-[18px]" /> Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="min-h-screen w-full px-4 py-6 md:px-space-lg md:py-space-lg">{children}</main>
      </div>

      {anyOpen && (
        <div
          className="fixed inset-0 z-30"
          onClick={() => {
            setSearchOpen(false);
            setBellOpen(false);
            setMenuOpen(false);
          }}
        />
      )}
    </div>
  );
}
