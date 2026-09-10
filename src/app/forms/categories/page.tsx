"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { Icon, PageHeader } from "@/components/ui";

interface CatRow {
  FormCategoryID: string;
  Name: string;
  SortOrder: number;
  Templates?: { FormTemplateID: string }[];
  _count?: { Templates: number };
}

export default function FormCategoriesPage() {
  const { user, token } = useAuth();
  const [cats, setCats] = useState<CatRow[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const canManage =
    user?.role.code === "SUPER_ADMIN" ||
    user?.permissions?.includes("FORM_TEMPLATE_MANAGE") ||
    false;

  function load() {
    if (!token) return;
    fetch("/api/form-categories", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: CatRow[]) =>
        setCats(
          (Array.isArray(d) ? d : []).sort((a, b) => a.SortOrder - b.SortOrder)
        )
      )
      .catch(() => setCats([]));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function create() {
    if (!name.trim() || busy) return;
    setError("");
    setBusy(true);
    try {
      const maxOrder = cats.reduce((m, c) => Math.max(m, c.SortOrder), 0);
      const r = await fetch("/api/form-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim(), sortOrder: maxOrder + 1 }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({} as { error?: string }));
        setError(d.error || "Create failed");
        return;
      }
      setName("");
      load();
    } catch {
      setError("Create failed — check your connection");
    } finally {
      setBusy(false);
    }
  }

  async function rename(id: string) {
    if (!renameValue.trim() || busy) return;
    setError("");
    setBusy(true);
    try {
      const r = await fetch(`/api/form-categories/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({} as { error?: string }));
        setError(d.error || "Rename failed");
        return;
      }
      setRenameId(null);
      load();
    } catch {
      setError("Rename failed — check your connection");
    } finally {
      setBusy(false);
    }
  }

  async function move(id: string, dir: -1 | 1) {
    if (busy) return;
    const i = cats.findIndex((c) => c.FormCategoryID === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cats.length) return;
    setError("");
    setBusy(true);
    try {
      // swap the two sort orders with two PUTs
      const a = cats[i];
      const b = cats[j];
      const h = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      const [ra, rb] = await Promise.all([
        fetch(`/api/form-categories/${a.FormCategoryID}`, {
          method: "PUT",
          headers: h,
          body: JSON.stringify({ sortOrder: b.SortOrder }),
        }),
        fetch(`/api/form-categories/${b.FormCategoryID}`, {
          method: "PUT",
          headers: h,
          body: JSON.stringify({ sortOrder: a.SortOrder }),
        }),
      ]);
      if (!ra.ok || !rb.ok) {
        setError("Reorder failed");
        return;
      }
      load();
    } catch {
      setError("Reorder failed — check your connection");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const r = await fetch(`/api/form-categories/${id}`, {
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-4">
        <Link
          href="/forms"
          className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <Icon name="arrow_back" className="text-[18px]" /> Back to templates
        </Link>
      </div>
      <PageHeader title="Form Categories" subtitle="Group request forms in the catalog" />
      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {canManage && (
        <div className="card mb-4 flex flex-col gap-2 p-4 sm:flex-row">
          <input
            className="input flex-1"
            placeholder="New category name (e.g. HR & Employee Support)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <button onClick={create} disabled={busy || !name.trim()} className="btn-primary disabled:opacity-50">
            + Add Category
          </button>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase text-ink-soft">
            <tr>
              <th className="w-16 px-4 py-3">Order</th>
              <th className="px-4 py-3">Name</th>
              <th className="w-32 px-4 py-3">Templates</th>
              {canManage && <th className="w-56 px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {cats.map((c, i) => {
              const inUse = c._count?.Templates ?? c.Templates?.length ?? 0;
              const confirming = confirmId === c.FormCategoryID;
              const renaming = renameId === c.FormCategoryID;
              return (
                <tr key={c.FormCategoryID} className="hover:bg-surface-muted">
                  <td className="px-4 py-3 text-ink-soft">{i + 1}</td>
                  <td className="px-4 py-3">
                    {renaming ? (
                      <span className="flex items-center gap-2">
                        <input
                          className="input !py-1.5"
                          value={renameValue}
                          autoFocus
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") rename(c.FormCategoryID);
                            if (e.key === "Escape") setRenameId(null);
                          }}
                        />
                        <button
                          onClick={() => rename(c.FormCategoryID)}
                          className="text-xs font-bold text-primary hover:underline"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setRenameId(null)}
                          className="text-xs font-semibold text-ink-soft hover:underline"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span className="font-medium text-ink">{c.Name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{inUse}</td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      {confirming ? (
                        <span className="inline-flex items-center gap-2 text-xs">
                          <span className="font-medium text-ink-soft">Delete?</span>
                          <button
                            onClick={() => remove(c.FormCategoryID)}
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
                      ) : renaming ? null : (
                        <span className="inline-flex items-center gap-1">
                          <button
                            className="icon-btn !h-7 !w-7"
                            disabled={i === 0 || busy}
                            onClick={() => move(c.FormCategoryID, -1)}
                            aria-label="Move up"
                          >
                            <Icon name="arrow_upward" className="text-[18px]" />
                          </button>
                          <button
                            className="icon-btn !h-7 !w-7"
                            disabled={i === cats.length - 1 || busy}
                            onClick={() => move(c.FormCategoryID, 1)}
                            aria-label="Move down"
                          >
                            <Icon name="arrow_downward" className="text-[18px]" />
                          </button>
                          <button
                            onClick={() => {
                              setRenameId(c.FormCategoryID);
                              setRenameValue(c.Name);
                            }}
                            className="px-1 text-xs font-semibold text-primary hover:underline"
                          >
                            Rename
                          </button>
                          <button
                            onClick={() => setConfirmId(c.FormCategoryID)}
                            disabled={inUse > 0}
                            title={inUse > 0 ? "Category has templates — cannot delete" : "Delete category"}
                            className="px-1 text-xs font-semibold text-danger hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline"
                          >
                            Delete
                          </button>
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {cats.length === 0 && (
              <tr>
                <td colSpan={canManage ? 4 : 3} className="px-4 py-8 text-center text-ink-faint">
                  No categories yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
