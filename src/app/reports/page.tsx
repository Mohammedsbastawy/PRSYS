"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { PageHeader, StatCard } from "@/components/ui";

interface Dash {
  total: number;
  byStatus: Record<string, number>;
  myPendingApprovals: number;
}

export default function ReportsPage() {
  const { token } = useAuth();
  const [data, setData] = useState<Dash | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch("/api/dashboard", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setData);
  }, [token]);

  return (
    <AppShell>
      <PageHeader title="Reports" subtitle="Request analytics" />
      {data && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Total" value={data.total} />
          <StatCard label="Pending" value={data.byStatus.pending} color="text-amber-600" />
          <StatCard label="Approved" value={data.byStatus.approved} color="text-blue-600" />
          <StatCard label="PO Registered" value={data.byStatus.poRegistered} color="text-purple-600" />
          <StatCard label="Fulfilled" value={data.byStatus.fulfilled} color="text-teal-600" />
          <StatCard label="Rejected" value={data.byStatus.rejected} color="text-red-600" />
          <StatCard label="Drafts" value={data.byStatus.draft} />
          <StatCard label="My Approvals" value={data.myPendingApprovals} color="text-purple-600" />
        </div>
      )}
    </AppShell>
  );
}
