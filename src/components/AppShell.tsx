"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useEffect } from "react";

const NAV = [
  { href: "/", label: "Dashboard", icon: "▦" },
  { href: "/requests", label: "Requests", icon: "📋" },
  { href: "/requests/new", label: "New Request", icon: "➕" },
  { href: "/forms", label: "Form Templates", icon: "📝" },
  { href: "/workflows", label: "Workflows", icon: "⚙" },
  { href: "/users", label: "Users", icon: "👤" },
  { href: "/departments", label: "Departments", icon: "🏢" },
  { href: "/groups", label: "Groups", icon: "👥" },
  { href: "/reports", label: "Reports", icon: "📊" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, token, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !token) router.push("/login");
  }, [loading, token, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-soft">
        Loading...
      </div>
    );
  }
  if (!token) return null;

  const can = (p: string) => user?.permissions?.includes(p) ?? false;

  return (
    <div className="flex h-screen bg-surface">
      <aside className="flex w-60 flex-col border-r border-surface-border bg-white">
        <div className="flex h-14 items-center gap-2 border-b border-surface-border px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-primary text-sm font-bold text-white">
            P
          </div>
          <span className="font-semibold text-ink">PRSYS</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.filter(
            (n) =>
              n.href !== "/users" ||
              can?.("USER_EDIT") ||
              can?.("USER_VIEW") ||
              can?.("USER_DELETE")
          )
            .filter(
              (n) =>
                n.href !== "/departments" ||
                can?.("DEP_MANAGE") ||
                can?.("DEP_VIEW")
            )
            .filter(
              (n) =>
                n.href !== "/groups" || can?.("GROUP_MANAGE") || can?.("GROUP_VIEW")
            )
            .filter(
              (n) =>
                n.href !== "/forms" || can?.("FORM_TEMPLATE_VIEW") || can?.("FORM_TEMPLATE_MANAGE")
            )
            .filter(
              (n) =>
                n.href !== "/workflows" || can?.("WF_VIEW") || can?.("WF_MANAGE")
            )
            .filter((n) => n.href !== "/reports" || can?.("REPORT_VIEW"))
            .map((n) => {
              const active =
                n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "border-l-2 border-primary bg-primary-container/40 text-primary"
                      : "text-ink-soft hover:bg-surface-muted"
                  }`}
                >
                  <span className="text-base">{n.icon}</span>
                  {n.label}
                </Link>
              );
            })}
        </nav>
        <div className="border-t border-surface-border p-3">
          <div className="mb-2 px-1 text-xs text-ink-faint">
            {user?.name}
            <br />
            <span className="font-medium text-ink-soft">{user?.role.name}</span>
          </div>
          <button onClick={logout} className="btn-ghost w-full justify-start text-danger">
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
