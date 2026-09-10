"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/ui";

interface Dep {
  DEPID: string;
  Name: string;
  Code: string;
}

export default function DepartmentsPage() {
  const { token } = useAuth();
  const [deps, setDeps] = useState<Dep[]>([]);

  useEffect(() => {
    if (!token) return;
    fetch("/api/departments", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setDeps);
  }, [token]);

  return (
    <AppShell>
      <PageHeader title="Departments" subtitle="Organization units" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {deps.map((d) => (
          <div key={d.DEPID} className="card p-4">
            <div className="font-semibold text-ink">{d.Name}</div>
            <div className="text-sm text-ink-soft">Code: {d.Code}</div>
          </div>
        ))}
        {deps.length === 0 && <p className="text-ink-faint">No departments</p>}
      </div>
    </AppShell>
  );
}
