"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui";

const TABS = [
  { href: "/users", label: "Users", icon: "group" },
  { href: "/departments", label: "Departments", icon: "domain" },
  { href: "/groups", label: "Groups", icon: "groups" },
];

/** Sub-navigation shared by the Users & Permissions admin section (mockup pattern). */
export default function AdminTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-6 flex items-center gap-1 border-b border-surface-border">
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors ${
              active
                ? "border-primary font-semibold text-primary-dark"
                : "border-transparent text-ink-soft hover:bg-surface-muted hover:text-ink"
            }`}
          >
            <Icon name={t.icon} className="text-[18px]" />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
