"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/ui";

interface Template {
  FormTemplateID: string;
  Name: string;
  Fields: { FormFieldID: string; Label: string; FieldType: string; IsRequired: boolean }[];
}

export default function NewRequestPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [items, setItems] = useState([{ name: "", qty: 1 }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    fetch("/api/form-templates", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setTemplates);
  }, [token]);

  const selected = templates.find((t) => t.FormTemplateID === templateId);

  function addItem() {
    setItems([...items, { name: "", qty: 1 }]);
  }
  function updateItem(i: number, k: "name" | "qty", v: string | number) {
    setItems(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  }
  function removeItem(i: number) {
    setItems(items.filter((_, j) => j !== i));
  }

  async function submit() {
    setError("");
    if (!templateId) return setError("Select a form template");
    setBusy(true);
    const res = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        formTemplateId: templateId,
        priority: "MEDIUM",
        fieldValues: Object.entries(values).map(([fieldId, value]) => ({ fieldId, value })),
        items: items
          .filter((it) => it.name.trim())
          .map((it) => ({ requestedItemName: it.name, requestedQuantity: Number(it.qty) })),
      }),
    });
    setBusy(false);
    if (res.ok) {
      const r = await res.json();
      router.push(`/requests/${r.RequestID}`);
    } else {
      const e = await res.json().catch(() => ({}));
      setError(e.error || "Failed to create");
    }
  }

  return (
    <AppShell>
      <PageHeader title="New Request" subtitle="Create a purchase request" />
      <div className="card max-w-2xl space-y-5 p-6">
        {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>}
        <div>
          <label className="label">Form Template</label>
          <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">— Select —</option>
            {templates.map((t) => (
              <option key={t.FormTemplateID} value={t.FormTemplateID}>
                {t.Name}
              </option>
            ))}
          </select>
        </div>

        {selected && (
          <>
            <div className="space-y-3 border-t border-surface-border pt-4">
              <h3 className="font-semibold text-ink">Form Fields</h3>
              {selected.Fields.map((f) => (
                <div key={f.FormFieldID}>
                  <label className="label">
                    {f.Label} {f.IsRequired && <span className="text-danger">*</span>}
                  </label>
                  <input
                    className="input"
                    type={f.FieldType === "number" ? "number" : "text"}
                    value={values[f.FormFieldID] || ""}
                    onChange={(e) => setValues({ ...values, [f.FormFieldID]: e.target.value })}
                  />
                </div>
              ))}
            </div>

            <div className="space-y-3 border-t border-surface-border pt-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-ink">Items</h3>
                <button type="button" className="btn-ghost text-primary" onClick={addItem}>
                  + Add item
                </button>
              </div>
              {items.map((it, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder="Item name"
                    value={it.name}
                    onChange={(e) => updateItem(i, "name", e.target.value)}
                  />
                  <input
                    className="input w-24"
                    type="number"
                    value={it.qty}
                    onChange={(e) => updateItem(i, "qty", e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-ghost text-danger"
                    onClick={() => removeItem(i)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <button className="btn-primary w-full" disabled={busy} onClick={submit}>
          {busy ? "Creating..." : "Create Request"}
        </button>
      </div>
    </AppShell>
  );
}
