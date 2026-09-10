"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/ui";

interface GroupRow {
  id: string;
  name: string;
  description?: string | null;
  members?: { UserID: string }[];
}

export default function GroupsPage() {
  const { token } = useAuth();
  const [groups, setGroups] = useState<GroupRow[]>([]);

  useEffect(() => {
    if (!token) return;
    fetch("/api/groups", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setGroups);
  }, [token]);

  return (
    <AppShell>
      <PageHeader title="Groups" subtitle="User groups" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {groups.map((g) => (
          <div key={g.id} className="card p-4">
            <div className="font-semibold text-ink">{g.name}</div>
            <div className="text-sm text-ink-soft">
              {g.description || "—"} · {g.members?.length || 0} members
            </div>
          </div>
        ))}
        {groups.length === 0 && <p className="text-ink-faint">No groups</p>}
      </div>
    </AppShell>
  );
}
