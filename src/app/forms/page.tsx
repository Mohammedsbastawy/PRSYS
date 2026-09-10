"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { PageHeader, StatusBadge } from "@/components/ui";

interface TemplateRow {
  FormTemplateID: string;
  Name: string;
  Description: string | null;
  Status: string;
  Category?: { Name: string } | null;
  Workflow?: { Name: string } | null;
  OwnerDEP?: { DEPID: string; Name: string } | null;
  OwnerGroup?: { GroupID: string; Name: string } | null;
  Fields?: { FormFieldID: string }[];
  _count?: { Requests: number };
}

export default function FormsPage() {
  const { user, token } = useAuth();
  const [forms, setForms] = useState<TemplateRow[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const canManage =
    user?.role.code === "SUPER_ADMIN" ||
    user?.permissions?.includes("FORM_TEMPLATE_MANAGE") ||
    false;

  function load() {
    if (!token) return;
    fetch("/api/form-templates", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: TemplateRow[]) => setForms(Array.isArray(d) ? d : []))
      .catch(() => setForms([]));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function toggleStatus(id: string, current: string) {
    setError("");
    const next = current === "ACTIVE" ? "DRAFT" : "ACTIVE";
    try {
      const r = await fetch(`/api/form-templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: next }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({} as { error?: string }));
        setError(d.error || "Update failed");
        return;
      }
      load();
    } catch {
      setError("Update failed — check your connection");
    }
  }

  async function remove(id: string) {
    setError("");
    try {
      const r = await fetch(`/api/form-templates/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok) {
        setError(d.error || "Delete failed");
        setConfirmId(null);
        return;
      }
      setConfirmId(null);
      load();
    } catch {
      setError("Delete failed — check your connection");
      setConfirmId(null);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Form Templates"
        subtitle="Request form definitions"
        action={
          canManage ? (
            <span className="inline-flex items-center gap-2">
              <Link href="/forms/categories" className="btn-secondary">
                Manage Categories
              </Link>
              <Link href="/forms/new" className="btn-primary">
                + New Template
              </Link>
            </span>
          ) : undefined
        }
      />
      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase text-ink-soft">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Workflow</th>
              <th className="px-4 py-3">Fields</th>
              <th className="px-4 py-3">Requests</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {forms.map((f) => {
              const inUse = f._count?.Requests ?? 0;
              const confirming = confirmId === f.FormTemplateID;
              return (
                <tr key={f.FormTemplateID} className="hover:bg-surface-muted">
                  <td className="px-4 py-3">
                    <span className="block font-medium text-ink">{f.Name}</span>
                    {(f.OwnerDEP?.Name || f.OwnerGroup?.Name) && (
                      <span className="block text-xs text-ink-soft">
                        Owner: {f.OwnerDEP?.Name || f.OwnerGroup?.Name}
                      </span>
                    )}
                    {f.Description && (
                      <span className="block max-w-[280px] truncate text-xs text-ink-soft">
                        {f.Description}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{f.Category?.Name || "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{f.Workflow?.Name || "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{f.Fields?.length || 0}</td>
                  <td className="px-4 py-3 text-ink-soft">{inUse}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={f.Status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {confirming ? (
                      <span className="inline-flex items-center gap-2 text-xs">
                        <span className="font-medium text-ink-soft">Delete?</span>
                        <button
                          onClick={() => remove(f.FormTemplateID)}
                          className="font-bold text-danger hover:underline"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="font-semibold text-ink-soft hover:underline"
                        >
                          No
                        </button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-3 text-xs font-semibold">
                        <Link
                          href={`/forms/${f.FormTemplateID}`}
                          className="text-primary hover:underline"
                        >
                          {canManage ? "Edit" : "View"}
                        </Link>
                        {canManage && (
                          <button
                            onClick={() => toggleStatus(f.FormTemplateID, f.Status)}
                            className="text-primary hover:underline"
                          >
                            {f.Status === "ACTIVE" ? "Unpublish" : "Publish"}
                          </button>
                        )}
                        {canManage && (
                          <button
                            onClick={() => setConfirmId(f.FormTemplateID)}
                            disabled={inUse > 0}
                            title={inUse > 0 ? "In use by requests — cannot delete" : "Delete template"}
                            className="text-danger hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline"
                          >
                            Delete
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {forms.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-faint">
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
