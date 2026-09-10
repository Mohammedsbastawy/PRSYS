"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { PageHeader, StatusBadge } from "@/components/ui";

export default function FormsPage() {
  const { token } = useAuth();
  const [forms, setForms] = useState<any[]>([]);

  useEffect(() => {
    if (!token) return;
    fetch("/api/form-templates", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setForms);
  }, [token]);

  return (
    <AppShell>
      <PageHeader title="Form Templates" subtitle="Request form definitions" />
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase text-ink-soft">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Workflow</th>
              <th className="px-4 py-3">Fields</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {forms.map((f) => (
              <tr key={f.FormTemplateID} className="hover:bg-surface-muted">
                <td className="px-4 py-3 font-medium text-ink">{f.Name}</td>
                <td className="px-4 py-3 text-ink-soft">{f.Category?.Name || "—"}</td>
                <td className="px-4 py-3 text-ink-soft">{f.Workflow?.Name || "—"}</td>
                <td className="px-4 py-3 text-ink-soft">{f.Fields?.length || 0}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={f.Status} />
                </td>
              </tr>
            ))}
            {forms.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-faint">
                  No form templates yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
