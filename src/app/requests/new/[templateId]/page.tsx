"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { EmptyState, Icon } from "@/components/ui";
import { parseFieldConfig } from "@/lib/field-config";

interface TField {
  FormFieldID: string;
  Label: string;
  FieldKey: string;
  FieldType: string;
  IsRequired: boolean;
  SortOrder: number;
  Config: string | null;
}
interface Template {
  FormTemplateID: string;
  Name: string;
  Description: string | null;
  Status: string;
  Category: { Name: string } | null;
  Fields: TField[];
}
interface CatItem {
  ItemCatalogCacheID: string;
  OracleItemID: string;
  ItemCode: string;
  ItemName: string;
  Uom: string;
  OrganizationCode: string;
  LastPurchasedPrice: number | string | null;
}
interface Row {
  key: number;
  catalogId: string | null;
  oracle: string | null;
  code: string;
  name: string;
  uom: string;
  qty: number;
  org: string;
  price: string;
}

const UOMS = ["Piece", "KG", "L", "Box", "Meter", "Pack", "Service", "Each"];
const PRIORITIES = [
  ["LOW", "Low"],
  ["MEDIUM", "Standard"],
  ["HIGH", "High"],
  ["URGENT", "Urgent"],
];


function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function DynamicRequestFormPage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const templateId = params.templateId as string;

  const [template, setTemplate] = useState<Template | null | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [neededBy, setNeededBy] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const [invalidTitle, setInvalidTitle] = useState(false);
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const [invalidRows, setInvalidRows] = useState<number[]>([]);

  const [cq, setCq] = useState("");
  const [cHits, setCHits] = useState<CatItem[]>([]);
  const [cOpen, setCOpen] = useState(false);
  const [cSearching, setCSearching] = useState(false);
  const keyRef = useRef(1);
  const cTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canCreate = user?.permissions?.includes("REQUEST_CREATE") ?? false;
  const canCatalog = user?.permissions?.includes("CATALOG_VIEW") ?? false;

  useEffect(() => {
    if (!token) return;
    fetch("/api/form-templates", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((all: Template[]) => setTemplate(all.find((t) => t.FormTemplateID === templateId) || null))
      .catch(() => setTemplate(null));
  }, [token, templateId]);

  // Catalog search (debounced)
  useEffect(() => {
    if (cTimer.current) clearTimeout(cTimer.current);
    if (cq.trim().length < 2 || !token || !canCatalog) {
      setCHits([]);
      setCSearching(false);
      return;
    }
    setCSearching(true);
    cTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/catalog?q=${encodeURIComponent(cq.trim())}&limit=8`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setCHits(r.ok ? await r.json() : []);
      } catch {
        setCHits([]);
      } finally {
        setCSearching(false);
      }
    }, 300);
    return () => {
      if (cTimer.current) clearTimeout(cTimer.current);
    };
  }, [cq, token, canCatalog]);

  function addCustomRow() {
    const key = keyRef.current++;
    setRows((p) => [...p, { key, catalogId: null, oracle: null, code: "", name: "", uom: "Piece", qty: 1, org: "", price: "" }]);
  }
  function addCatalogRow(it: CatItem) {
    if (rows.some((r) => r.catalogId === it.ItemCatalogCacheID)) {
      setCq("");
      setCOpen(false);
      return;
    }
    const key = keyRef.current++;
    setRows((p) => [
      ...p,
      {
        key,
        catalogId: it.ItemCatalogCacheID,
        oracle: it.OracleItemID,
        code: it.ItemCode,
        name: it.ItemName,
        uom: it.Uom,
        qty: 1,
        org: it.OrganizationCode,
        price: it.LastPurchasedPrice !== null ? String(it.LastPurchasedPrice) : "",
      },
    ]);
    setCq("");
    setCOpen(false);
  }
  function updateRow(key: number, patch: Partial<Row>) {
    setRows((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function removeRow(key: number) {
    setRows((p) => p.filter((r) => r.key !== key));
  }

  function validate(submit: boolean): boolean {
    if (!submit) return true;
    const badFields =
      template?.Fields.filter((f) => f.IsRequired && !(values[f.FormFieldID] || "").trim()).map(
        (f) => f.FormFieldID
      ) || [];
    const badRows = rows
      .filter((r) => !r.name.trim() || !(r.qty > 0) || (r.price.trim() !== "" && isNaN(Number(r.price))))
      .map((r) => r.key);
    const badTitle = title.trim() === "";
    setInvalidFields(badFields);
    setInvalidRows(badRows);
    setInvalidTitle(badTitle);
    const msgs: string[] = [];
    if (badTitle) msgs.push("Request title is required");
    if (badFields.length > 0 && template) {
      const labels = template.Fields.filter((f) => badFields.includes(f.FormFieldID)).map((f) => f.Label);
      msgs.push(`Missing required fields: ${labels.join(", ")}`);
    }
    if (rows.length === 0) msgs.push("Add at least one item");
    else if (badRows.length > 0) msgs.push("Some items are missing a name, quantity or valid price");
    if (msgs.length > 0) {
      setError(msgs.join(" · "));
      return false;
    }
    return true;
  }

  async function persist(submit: boolean) {
    if (!template || busy) return;
    setError("");
    setInvalidFields([]);
    setInvalidRows([]);
    setInvalidTitle(false);
    if (!validate(submit)) return;
    setBusy(submit ? "submit" : "draft");
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          formTemplateId: template.FormTemplateID,
          title: title.trim() || undefined,
          priority,
          neededByDate: neededBy || undefined,
          fieldValues: Object.entries(values)
            .filter(([, v]) => v.trim() !== "")
            .map(([fieldId, value]) => ({ fieldId, value: value.trim() })),
          items: rows
            .filter((r) => r.name.trim() && r.qty > 0)
            .map((r) => ({
              requestedItemName: r.name.trim(),
              requestedQuantity: Number(r.qty),
              requestedUom: r.uom || undefined,
              itemCatalogCacheId: r.catalogId,
              oracleItemId: r.oracle,
              itemCode: r.code || undefined,
              itemName: r.catalogId ? r.name.trim() : undefined,
              uom: r.uom || undefined,
              organizationCode: r.org || undefined,
              estimatedPrice: r.price.trim() === "" ? undefined : Number(r.price),
            })),
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(e.error || "Failed to create request");
      }
      const created = await res.json();

      if (files.length > 0) {
        const fails: string[] = [];
        await Promise.all(
          files.map(async (f) => {
            const fd = new FormData();
            fd.append("file", f);
            try {
              const up = await fetch(`/api/requests/${created.RequestID}/attachments`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: fd,
              });
              if (!up.ok) fails.push(f.name);
            } catch {
              fails.push(f.name);
            }
          })
        );
        if (fails.length > 0) throw new Error(`Saved as draft, but these files failed to upload: ${fails.join(", ")}`);
      }

      if (submit) {
        const s = await fetch(`/api/requests/${created.RequestID}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "SUBMIT" }),
        });
        if (!s.ok) {
          const e = await s.json().catch(() => ({} as { error?: string }));
          throw new Error(e.error || "Request saved as draft, but submit failed");
        }
      }
      router.push(`/requests/${created.RequestID}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  if (!canCreate) {
    return (
      <AppShell>
        <div className="card">
          <EmptyState icon="block" title="No permission" hint="Your account is not allowed to create requests." />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1024px]">
        {template === undefined ? (
          <div className="py-10 text-center text-sm text-ink-soft">Loading form...</div>
        ) : template === null || template.Status !== "ACTIVE" ? (
          <div className="card">
            <EmptyState
              icon="description"
              title="Form not available"
              hint="This request form doesn't exist or hasn't been published yet."
              action={
                <Link href="/requests/new" className="btn-secondary">
                  Back to catalog
                </Link>
              }
            />
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-end justify-between border-b border-surface-border pb-4">
              <div>
                <h1 className="text-3xl font-bold text-ink">{template.Name}</h1>
                <p className="mt-1 text-sm text-ink-soft">
                  {template.Description || template.Category?.Name || "Fill in the details below"}
                </p>
              </div>
              <Link
                href="/requests/new"
                className="flex items-center gap-1 text-sm text-ink-soft transition-colors hover:text-ink"
              >
                <Icon name="close" className="text-[16px]" /> Cancel
              </Link>
            </div>

            {error && (
              <div className="mb-4 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <Icon name="error" className="mt-0.5 text-[18px]" />
                <span>{error}</span>
              </div>
            )}

            <div className="card overflow-hidden">
              {/* Request Details */}
              <div className="border-b border-surface-border p-6 md:p-8">
                <h2 className="mb-5 border-l-2 border-primary pl-3 text-lg font-semibold text-ink">
                  Request Details
                </h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <label className="label" htmlFor="req-title">
                      Request Title <span className="text-danger">*</span>
                    </label>
                    <input
                      id="req-title"
                      className={`input ${invalidTitle ? "!border-danger" : ""}`}
                      placeholder="e.g. Q4 Buffer Solution Batch A"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="req-priority">
                      Priority
                    </label>
                    <select
                      id="req-priority"
                      className="input"
                      value={priority}
                      onChange={(e) => setPriority(e.target.value)}
                    >
                      {PRIORITIES.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="req-needed">
                      Needed By Date
                    </label>
                    <input
                      id="req-needed"
                      type="date"
                      className="input"
                      value={neededBy}
                      onChange={(e) => setNeededBy(e.target.value)}
                    />
                  </div>
                  {template.Fields.sort((a, b) => a.SortOrder - b.SortOrder).map((f) => {
                    const invalid = invalidFields.includes(f.FormFieldID);
                    const cls = `input ${invalid ? "!border-danger" : ""}`;
                    const wide = f.FieldType === "textarea";
                    const cfg = parseFieldConfig(f.Config);
                    return (
                      <div key={f.FormFieldID} className={wide ? "md:col-span-2" : ""}>
                        {f.FieldType !== "checkbox" && (
                          <label className="label" htmlFor={f.FormFieldID}>
                            {f.Label} {f.IsRequired && <span className="text-danger">*</span>}
                          </label>
                        )}
                        {f.FieldType === "checkbox" ? (
                          <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm text-ink">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={(values[f.FormFieldID] || "") === "true"}
                              onChange={(e) =>
                                setValues({ ...values, [f.FormFieldID]: e.target.checked ? "true" : "" })
                              }
                            />
                            <span className="font-medium">
                              {f.Label} {f.IsRequired && <span className="text-danger">*</span>}
                            </span>
                          </label>
                        ) : f.FieldType === "textarea" ? (
                          <textarea
                            id={f.FormFieldID}
                            rows={3}
                            placeholder={cfg.placeholder || undefined}
                            className={cls}
                            value={values[f.FormFieldID] || ""}
                            onChange={(e) => setValues({ ...values, [f.FormFieldID]: e.target.value })}
                          />
                        ) : f.FieldType === "select" ? (
                          <select
                            id={f.FormFieldID}
                            className={cls}
                            value={values[f.FormFieldID] || ""}
                            onChange={(e) => setValues({ ...values, [f.FormFieldID]: e.target.value })}
                          >
                            <option value="">Select...</option>
                            {parseFieldConfig(f.Config).options.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={f.FormFieldID}
                            type={f.FieldType === "number" ? "number" : f.FieldType === "date" ? "date" : "text"}
                            placeholder={cfg.placeholder || undefined}
                            className={cls}
                            value={values[f.FormFieldID] || ""}
                            onChange={(e) => setValues({ ...values, [f.FormFieldID]: e.target.value })}
                          />
                        )}
                        {cfg.help && (
                          <p className="mt-1 text-xs text-ink-faint">{cfg.help}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Items */}
              <div className="border-b border-surface-border p-6 md:p-8">
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="border-l-2 border-primary pl-3 text-lg font-semibold text-ink">Items</h2>
                  <button type="button" className="btn-secondary !py-1.5" onClick={addCustomRow}>
                    <Icon name="add" className="text-[18px]" /> Add item
                  </button>
                </div>

                {canCatalog && (
                  <div className="relative mb-4">
                    <label className="label">Search Oracle Item Catalog (Item Code or Name)</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
                        <Icon name="search" className="text-[20px]" />
                      </span>
                      <input
                        className="input !pl-10"
                        placeholder="e.g. Sodi... or RM-9002"
                        value={cq}
                        onChange={(e) => {
                          setCq(e.target.value);
                          setCOpen(true);
                        }}
                        onFocus={() => setCOpen(true)}
                        onBlur={() => setTimeout(() => setCOpen(false), 150)}
                      />
                    </div>
                    {cOpen && cq.trim().length >= 2 && (
                      <div className="dropdown left-0 right-0">
                        {cSearching ? (
                          <div className="px-4 py-3 text-sm text-ink-soft">Searching catalog...</div>
                        ) : cHits.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-ink-soft">
                            No catalog matches — use &quot;Add item&quot; for a custom entry
                          </div>
                        ) : (
                          cHits.map((h) => (
                            <button
                              key={h.ItemCatalogCacheID}
                              type="button"
                              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => addCatalogRow(h)}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm text-ink">
                                  <span className="font-semibold">[{h.ItemCode}]</span> {h.ItemName}
                                </span>
                                <span className="block text-xs text-ink-faint">
                                  {h.OrganizationCode}
                                  {h.LastPurchasedPrice !== null
                                    ? ` · Last price ${h.LastPurchasedPrice}`
                                    : ""}
                                </span>
                              </span>
                              <span className="shrink-0 text-sm text-ink-soft">{h.Uom}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}

                {rows.length === 0 ? (
                  <div className="rounded border border-dashed border-surface-border bg-surface px-4 py-6 text-center text-sm text-ink-soft">
                    No items yet — search the catalog above or add a custom item.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded border border-surface-border">
                    <table className="tbl w-full min-w-[720px]">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th className="w-28">UOM</th>
                          <th className="w-28">Quantity</th>
                          <th className="w-32">Est. Price</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => {
                          const bad = invalidRows.includes(r.key);
                          const uomOpts = UOMS.includes(r.uom) ? UOMS : [r.uom, ...UOMS];
                          return (
                            <tr key={r.key} className={bad ? "!bg-red-50" : ""}>
                              <td>
                                <input
                                  className="input !border-transparent !px-0 font-medium hover:!border-surface-border focus:!border-primary"
                                  placeholder="Item name / description"
                                  value={r.name}
                                  onChange={(e) => updateRow(r.key, { name: e.target.value })}
                                />
                                <div className="text-xs text-ink-faint">
                                  {r.code ? (
                                    <>
                                      {r.code}
                                      {r.org ? ` · ${r.org}` : ""}
                                    </>
                                  ) : (
                                    "Custom item"
                                  )}
                                </div>
                              </td>
                              <td>
                                <select
                                  className="input"
                                  value={r.uom}
                                  onChange={(e) => updateRow(r.key, { uom: e.target.value })}
                                >
                                  {uomOpts.map((u) => (
                                    <option key={u} value={u}>
                                      {u}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  className="input"
                                  value={r.qty}
                                  onChange={(e) =>
                                    updateRow(r.key, { qty: parseFloat(e.target.value) || 0 })
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  placeholder="Optional"
                                  className="input"
                                  value={r.price}
                                  onChange={(e) => updateRow(r.key, { price: e.target.value })}
                                />
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="icon-btn !h-8 !w-8 text-danger"
                                  onClick={() => removeRow(r.key)}
                                  aria-label="Remove item"
                                >
                                  <Icon name="delete" className="text-[18px]" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Attachments */}
              <div className="p-6 md:p-8">
                <h2 className="mb-1 border-l-2 border-primary pl-3 text-lg font-semibold text-ink">
                  Attachments
                </h2>
                <p className="mb-4 text-[13px] text-ink-soft">
                  Quotations, specifications or supporting documents (max 10 MB each).
                </p>
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-surface-border bg-surface px-4 py-5 text-sm font-medium text-ink-soft transition-colors hover:border-primary hover:text-primary-dark">
                  <Icon name="attach_file" className="text-[20px]" />
                  Choose files...
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const picked = Array.from(e.target.files || []);
                      if (picked.length > 0) setFiles((p) => [...p, ...picked]);
                      e.target.value = "";
                    }}
                  />
                </label>
                {files.length > 0 && (
                  <div className="mt-3 divide-y divide-surface-border rounded border border-surface-border">
                    {files.map((f, i) => (
                      <div key={`${f.name}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                        <Icon name="description" className="text-[20px] text-ink-faint" />
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">{f.name}</span>
                        <span className="text-xs text-ink-faint">{fmtSize(f.size)}</span>
                        <button
                          type="button"
                          className="icon-btn !h-7 !w-7 text-danger"
                          onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                          aria-label="Remove file"
                        >
                          <Icon name="close" className="text-[16px]" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                className="btn-secondary"
                disabled={busy !== null}
                onClick={() => persist(false)}
              >
                {busy === "draft" ? "Saving..." : "Save Draft"}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy !== null}
                onClick={() => persist(true)}
              >
                <Icon name="send" className="text-[18px]" />
                {busy === "submit" ? "Submitting..." : "Submit Request"}
              </button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
