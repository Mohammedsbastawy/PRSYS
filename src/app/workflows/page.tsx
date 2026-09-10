"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/ui";

export default function WorkflowsPage() {
  const { token } = useAuth();
  const [wfs, setWfs] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    fetch("/api/workflows", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setWfs);
  }, [token]);

  return (
    <AppShell>
      <PageHeader title="Workflows" subtitle="Approval workflow definitions" />
      <div className="space-y-4">
        {wfs.map((w) => (
          <div key={w.WFDefinitionID} className="card p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-ink">{w.Name}</h3>
              <span className="badge bg-blue-100 text-blue-800">{w.Status}</span>
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm">
              {w.Steps?.map((s: any, i: number) => (
                <span key={s.WFStepID} className="flex items-center gap-2">
                  <span className="rounded bg-surface-muted px-2 py-1 text-ink-soft">
                    {i + 1}. {s.StepName} ({s.ApproverType})
                  </span>
                  {i < w.Steps.length - 1 && <span className="text-ink-faint">→</span>}
                </span>
              ))}
            </div>
          </div>
        ))}
        {wfs.length === 0 && <p className="text-ink-faint">No workflows yet</p>}
      </div>
    </AppShell>
  );
}
