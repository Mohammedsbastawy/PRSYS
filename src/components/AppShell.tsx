"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { Avatar, Icon, StatusBadge, timeAgo } from "@/components/ui";

interface NavItem {
  href: string;
  label: string;
  perm?: string[];
  anyOf?: string[];
}

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/requests", label: "Requests", anyOf: ["REQUEST_VIEW_ALL", "REQUEST_VIEW_OWN", "REQUEST_CREATE"] },
  { href: "/requests/new", label: "New Request", anyOf: ["REQUEST_CREATE"] },
  { href: "/approvals", label: "Approvals", anyOf: ["REQUEST_APPROVE"] },
  { href: "/users", label: "Users", anyOf: ["USER_VIEW", "USER_CREATE", "USER_EDIT", "USER_DELETE"] },
  { href: "/departments", label: "Departments", anyOf: ["DEP_VIEW", "DEP_MANAGE"] },
  { href: "/groups", label: "Groups", anyOf: ["GROUP_MANAGE"] },
  { href: "/forms", label: "Forms", anyOf: ["FORM_TEMPLATE_VIEW", "FORM_TEMPLATE_MANAGE"] },
  { href: "/workflows", label: "Workflows", anyOf: ["WF_VIEW", "WF_MANAGE"] },
  { href: "/reports", label: "Reports", anyOf: ["REPORT_VIEW"] },
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
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!loading && !token) router.push("/login");
  }, [loading, token, router]);

  // Close popups on navigation
  useEffect(() => {
    setSearchOpen(false);
    setBellOpen(false);
    setMenuOpen(false);
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
      <div className="flex h-screen items-center justify-center text-ink-soft">
        <span className="flex items-center gap-2">
          <Icon name="progress_activity" className="animate-spin text-[22px]" /> Loading...
        </span>
      </div>
    );
  }
  if (!token) return null;

  const can = (p: string) => user?.permissions?.includes(p) ?? false;
  const isSuper = user?.role.code === "SUPER_ADMIN";
  const visibleNav = NAV.filter(
    (n) => !n.anyOf || n.anyOf.some((p) => can(p)) || (isSuper && true)
  ).map((n) =>
    n.href === "/requests" && !can("REQUEST_VIEW_ALL") ? { ...n, label: "My Requests" } : n
  );
  const anyOpen = searchOpen || bellOpen || menuOpen;

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="sticky top-0 z-40 border-b border-surface-border bg-white">
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-3 px-4 md:gap-4 md:px-8">
          {/* Brand */}
          <Link href="/" className="flex shrink-0 items-center gap-2 text-xl font-bold text-primary-dark">
            <Icon name="account_balance" filled className="text-[26px]" />
            <span className="hidden sm:inline">PRSYS</span>
          </Link>

          {/* Tabs */}
          <nav className="no-scrollbar flex h-full flex-1 items-stretch gap-1 overflow-x-auto">
            {visibleNav.map((n) => {
              const active =
                n.href === "/"
                  ? pathname === "/"
                  : n.href === "/requests/new"
                    ? pathname.startsWith("/requests/new")
                    : n.href === "/requests"
                      ? pathname === "/requests" ||
                        (pathname.startsWith("/requests/") && !pathname.startsWith("/requests/new"))
                      : pathname.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} className={`nav-tab ${active ? "nav-tab-active" : ""}`}>
                  {n.label}
                  {n.href === "/approvals" && pendingCount > 0 && (
                    <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                      {pendingCount > 99 ? "99+" : pendingCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Global search */}
          <div className="relative hidden shrink-0 md:block">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint">
              <Icon name="search" className="text-[20px]" />
            </span>
            <input
              className="input w-56 !pl-9"
              placeholder="Search requests..."
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
            {searchOpen && query.trim().length >= 2 && (
              <div className="dropdown w-96">
                {searching ? (
                  <div className="px-4 py-3 text-sm text-ink-soft">Searching...</div>
                ) : hits.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-ink-soft">No matching requests</div>
                ) : (
                  <div className="max-h-80 overflow-y-auto py-1">
                    {hits.map((h) => (
                      <Link
                        key={h.RequestID}
                        href={`/requests/${h.RequestID}`}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-primary-dark">
                            {h.TrackingNumber}
                          </span>
                          <span className="block truncate text-xs text-ink-soft">
                            {h.Title || h.FormTemplate?.Name}
                          </span>
                        </span>
                        <StatusBadge status={h.Status} />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bell */}
          <div className="relative shrink-0">
            <button
              className="icon-btn relative"
              aria-label="Notifications"
              onClick={() => {
                setBellOpen(!bellOpen);
                setMenuOpen(false);
                if (!bellOpen) loadNotifs();
              }}
            >
              <Icon name="notifications" />
              {unread > 0 && (
                <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </button>
            {bellOpen && (
              <div className="dropdown w-[380px]">
                <div className="flex items-center justify-between border-b border-surface-border px-4 py-2.5">
                  <span className="text-sm font-semibold text-ink">Notifications</span>
                  {unread > 0 && (
                    <button
                      className="text-xs font-medium text-primary-dark hover:underline"
                      onClick={() => markRead("all")}
                    >
                      Mark all as read
                    </button>
                  )}
                </div>
                <div className="slim-scroll max-h-96 overflow-y-auto">
                  {notifs.length === 0 && (
                    <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
                      <Icon name="notifications_off" className="text-[28px] text-ink-faint" />
                      <div className="text-sm font-medium text-ink">You&apos;re all caught up</div>
                      <div className="text-xs text-ink-soft">New updates will appear here</div>
                    </div>
                  )}
                  {notifs.map((n) => (
                    <button
                      key={n.NotificationID}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface ${n.IsRead ? "" : "bg-blue-50/50"}`}
                      onClick={() => markRead([n.NotificationID], n.RelatedRequestID)}
                    >
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.IsRead ? "bg-gray-200" : "bg-primary"}`} />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink">{n.Title}</span>
                        <span className="block truncate text-xs text-ink-soft">{n.Message}</span>
                        <span className="block text-[11px] text-ink-faint">{timeAgo(n.CreatedAt)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Help */}
          <Link href="/help" className="icon-btn shrink-0" aria-label="Help">
            <Icon name="help" />
          </Link>

          {/* User chip */}
          <div className="relative shrink-0">
            <button
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1 transition-colors hover:bg-surface-muted sm:border-l sm:border-surface-border sm:pl-3"
              onClick={() => {
                setMenuOpen(!menuOpen);
                setBellOpen(false);
              }}
            >
              <span className="hidden text-right sm:block">
                <span className="block text-xs font-semibold leading-tight text-ink">{user?.name}</span>
                <span className="block text-[11px] leading-tight text-ink-soft">{user?.role.name}</span>
              </span>
              <Avatar name={user?.name || "?"} />
            </button>
            {menuOpen && (
              <div className="dropdown w-64">
                <div className="flex items-center gap-3 border-b border-surface-border px-4 py-3">
                  <Avatar name={user?.name || "?"} size="lg" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink">{user?.name}</div>
                    <div className="truncate text-xs text-ink-soft">{user?.email}</div>
                    <span className="badge mt-1 bg-blue-100 text-blue-800">{user?.role.name}</span>
                  </div>
                </div>
                <div className="p-2">
                  <button
                    onClick={logout}
                    className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm font-medium text-danger hover:bg-red-50"
                  >
                    <Icon name="logout" className="text-[18px]" /> Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

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

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-8 md:px-8">{children}</main>

      <footer className="border-t border-surface-border bg-white">
        <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between px-4 py-3 text-xs text-ink-faint md:px-8">
          <span>© {new Date().getFullYear()} PRSYS — Procurement Request System</span>
          <Link href="/help" className="hover:text-primary-dark hover:underline">
            Need help? Contact IT Support
          </Link>
        </div>
      </footer>
    </div>
  );
}
