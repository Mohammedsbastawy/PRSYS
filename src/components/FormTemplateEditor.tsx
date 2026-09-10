"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { Icon, StatusBadge } from "@/components/ui";

interface FieldDraft {
  key: string;
  id?: string;
  label: string;
  fieldKey: string;
  keyTouched: boolean;
  fieldType: string;
  isRequired: boolean;
  optionsText: string;
  config: string | null;
}

interface LoadedField {
  FormFieldID: string;
  Label: string;
  FieldKey: string;
  FieldType: string;
  IsRequired: boolean;
  SortOrder: number;
  Config: string | null;
}

interface LoadedTemplate {
  FormTemplateID: string;
  Name: string;
  Description: string | null;
  FormCategoryID: string | null;
  WFDefinitionID: string | null;
  Status: string;
  Fields: LoadedField[];
}

interface CatRow {
  FormCategoryID: string;
  Name: string;
}

interface WfRow {
  WFDefinitionID: string;
  Name: string;
}

const FIELD_TYPES = [
  { value: "text", label: "Text Input" },
  { value: "textarea", label: "Textarea" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date Picker" },
  { value: "select", label: "Dropdown" },
];

const KNOWN_TYPES = FIELD_TYPES.map((t) => t.value);

let draftSeq = 0;
function nextKey(): string {
  draftSeq += 1;
  return `draft-${Date.now()}-${draftSeq}`;
}

function slugify(s: string): string {
  const k = s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return k || "field";
}

function optionsFromConfig(cfg: string | null): string[] {
  if (!cfg) return [];
  try {
    const o: unknown = JSON.parse(cfg);
    const arr: unknown = Array.isArray(o)
      ? o
      : typeof o === "object" && o !== null && "options" in o
        ? (o as { options: unknown }).options
        : [];
    if (!Array.isArray(arr)) return [];
    return arr.map((x: unknown) =>
      typeof x === "object" && x !== null && "label" in x
        ? String((x as { label: unknown }).label)
        : String(x)
    );
  } catch {
    return [];
  }
}

function blankField(type: string): FieldDraft {
  return {
    key: nextKey(),
    label: "",
    fieldKey: "",
    keyTouched: false,
    fieldType: type,
    isRequired: false,
    optionsText: "",
    config: null,
  };
}

export default function FormTemplateEditor({ templateId }: { templateId: string | null }) {
  const { user, token } = useAuth();
  const router = useRouter();
  const isNew = templateId === null;
  const canManage =
    user?.role.code === "SUPER_ADMIN" ||
    user?.permissions?.includes("FORM_TEMPLATE_MANAGE") ||
    false;

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [status, setStatus] = useState("DRAFT");
  const [fields, setFields] = useState<FieldDraft[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [wfs, setWfs] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!token) return;
    const h = { Authorization: `Bearer ${token}` };
    fetch("/api/form-categories", { headers: h })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: CatRow[]) =>
        setCats((d || []).map((c) => ({ id: c.FormCategoryID, name: c.Name })))
      )
      .catch(() => setCats([]));
    fetch("/api/workflows", { headers: h })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: WfRow[]) =>
        setWfs((d || []).map((w) => ({ id: w.WFDefinitionID, name: w.Name })))
      )
      .catch(() => setWfs([]));
    if (!isNew && templateId) {
      setLoading(true);
      fetch(`/api/form-templates/${templateId}`, { headers: h })
        .then((r) => (r.ok ? r.json() : null))
        .then((t: LoadedTemplate | null) => {
          if (!t) {
            setError("Template not found");
            return;
          }
          setName(t.Name);
          setDescription(t.Description ?? "");
          setCategoryId(t.FormCategoryID ?? "");
          setWorkflowId(t.WFDefinitionID ?? "");
          setStatus(t.Status);
          setFields(
            (t.Fields || []).map((f) => ({
              key: nextKey(),
              id: f.FormFieldID,
              label: f.Label,
              fieldKey: f.FieldKey,
              keyTouched: true,
              fieldType: KNOWN_TYPES.includes(f.FieldType) ? f.FieldType : "text",
              isRequired: f.IsRequired,
              optionsText:
                f.FieldType === "select" ? optionsFromConfig(f.Config).join("\n") : "",
              config: f.Config,
            }))
          );
        })
        .catch(() => setError("Failed to load template"))
        .finally(() => setLoading(false));
    }
  }, [token, isNew, templateId]);

  function patchField(key: string, patch: Partial<FieldDraft>) {
    setFields((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }

  function moveField(key: string, dir: -1 | 1) {
    setFields((prev) => {
      const i = prev.findIndex((f) => f.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function removeField(key: string) {
    setFields((prev) => prev.filter((f) => f.key !== key));
  }

  async function save() {
    setError("");
    if (!name.trim()) {
      setError("Template name is required");
      return;
    }
    const seen = new Set<string>();
    for (const f of fields) {
      if (!f.label.trim()) {
        setError("Every field needs a label");
        return;
      }
      const k = f.fieldKey.trim();
      if (!/^[A-Za-z0-9_]+$/.test(k)) {
        setError(
          `Invalid key "${f.fieldKey || "(empty)"}": use letters, numbers and underscore only`
        );
        return;
      }
      if (seen.has(k.toLowerCase())) {
        setError(`Duplicate field key: ${k}`);
        return;
      }
      seen.add(k.toLowerCase());
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        formCategoryId: categoryId || null,
        wfDefinitionId: workflowId || null,
        status,
        fields: fields.map((f, i) => {
          let config: string | null = f.config;
          if (f.fieldType === "select") {
            const opts = f.optionsText
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean);
            config = opts.length > 0 ? JSON.stringify(opts) : null;
          }
          return {
            ...(f.id ? { id: f.id } : {}),
            label: f.label.trim(),
            fieldKey: f.fieldKey.trim(),
            fieldType: f.fieldType,
            isRequired: f.isRequired,
            sortOrder: i,
            config,
          };
        }),
      };
      const url = isNew ? "/api/form-templates" : `/api/form-templates/${templateId}`;
      const r = await fetch(url, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok) {
        setError(d.error || "Save failed");
        return;
      }
      router.push("/forms");
    } catch {
      setError("Save failed — check your connection");
    } finally {
      setSaving(false);
    }
  }

  const ro = !canManage;

  return (
    <AppShell>
      <div className="mb-4">
        <Link
          href="/forms"
          className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <Icon name="arrow_back" className="text-[18px]" /> Back to templates
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-ink">
              {isNew ? "New Form Template" : `Edit Form: ${name || "..."}`}
            </h1>
            {!isNew && <StatusBadge status={status} />}
          </div>
          {canManage && (
            <button onClick={save} disabled={saving || loading} className="btn-primary disabled:opacity-50">
              <span className="inline-flex items-center gap-1.5">
                <Icon name="save" className="text-[18px]" />
                {saving ? "Saving..." : isNew ? "Create Template" : "Save Changes"}
              </span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-ink-soft">Loading template...</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <div className="card p-5">
              <h2 className="mb-4 text-base font-semibold text-ink">Form Settings</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="label" htmlFor="tmpl-name">
                    Template Name <span className="text-danger">*</span>
                  </label>
                  <input
                    id="tmpl-name"
                    className="input"
                    value={name}
                    disabled={ro}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Raw Material Request"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="label" htmlFor="tmpl-desc">
                    Description
                  </label>
                  <textarea
                    id="tmpl-desc"
                    rows={2}
                    className="input"
                    value={description}
                    disabled={ro}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Shown on the New Request catalog card"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="tmpl-cat">
                    Category
                  </label>
                  <select
                    id="tmpl-cat"
                    className="input"
                    value={categoryId}
                    disabled={ro}
                    onChange={(e) => setCategoryId(e.target.value)}
                  >
                    <option value="">No category</option>
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="tmpl-wf">
                    Approval Workflow
                  </label>
                  <select
                    id="tmpl-wf"
                    className="input"
                    value={workflowId}
                    disabled={ro}
                    onChange={(e) => setWorkflowId(e.target.value)}
                  >
                    <option value="">No workflow (auto-approve)</option>
                    {wfs.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="tmpl-status">
                    Status
                  </label>
                  <select
                    id="tmpl-status"
                    className="input"
                    value={status}
                    disabled={ro}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="DRAFT">Draft</option>
                    <option value="ACTIVE">Active</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="card p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-ink">
                  Fields ({fields.length})
                </h2>
              </div>
              {canManage && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {FIELD_TYPES.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => setFields((prev) => [...prev, blankField(t.value)])}
                      className="inline-flex items-center gap-1 rounded border border-surface-border bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:border-primary hover:text-primary"
                    >
                      <Icon name="add" className="text-[16px]" /> {t.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="space-y-3">
                {fields.map((f, i) => (
                  <div key={f.key} className="rounded border border-surface-border bg-surface p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wide text-ink-faint">
                        #{i + 1} — {FIELD_TYPES.find((t) => t.value === f.fieldType)?.label}
                        {f.isRequired && <span className="ml-1 text-danger">*</span>}
                      </span>
                      {canManage && (
                        <span className="flex items-center gap-1">
                          <button
                            className="icon-btn !h-7 !w-7"
                            disabled={i === 0}
                            onClick={() => moveField(f.key, -1)}
                            aria-label="Move up"
                          >
                            <Icon name="arrow_upward" className="text-[18px]" />
                          </button>
                          <button
                            className="icon-btn !h-7 !w-7"
                            disabled={i === fields.length - 1}
                            onClick={() => moveField(f.key, 1)}
                            aria-label="Move down"
                          >
                            <Icon name="arrow_downward" className="text-[18px]" />
                          </button>
                          <button
                            className="icon-btn !h-7 !w-7 text-danger hover:bg-red-50"
                            onClick={() => removeField(f.key)}
                            aria-label="Remove field"
                          >
                            <Icon name="delete" className="text-[18px]" />
                          </button>
                        </span>
                      )}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <label className="label">Label</label>
                        <input
                          className="input"
                          value={f.label}
                          disabled={ro}
                          onChange={(e) => {
                            const label = e.target.value;
                            patchField(f.key, {
                              label,
                              ...(f.keyTouched ? {} : { fieldKey: slugify(label) }),
                            });
                          }}
                          placeholder="e.g. Justification"
                        />
                      </div>
                      <div>
                        <label className="label">Key (unique)</label>
                        <input
                          className="input font-mono text-xs"
                          value={f.fieldKey}
                          disabled={ro}
                          onChange={(e) => patchField(f.key, { fieldKey: e.target.value, keyTouched: true })}
                          placeholder="auto-generated"
                        />
                      </div>
                      <div>
                        <label className="label">Type</label>
                        <select
                          className="input"
                          value={f.fieldType}
                          disabled={ro}
                          onChange={(e) => patchField(f.key, { fieldType: e.target.value })}
                        >
                          {FIELD_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-end pb-2">
                        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-ink-soft">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={f.isRequired}
                            disabled={ro}
                            onChange={(e) => patchField(f.key, { isRequired: e.target.checked })}
                          />
                          Required field
                        </label>
                      </div>
                      {f.fieldType === "select" && (
                        <div className="md:col-span-2">
                          <label className="label">Dropdown options (one per line)</label>
                          <textarea
                            rows={3}
                            className="input"
                            value={f.optionsText}
                            disabled={ro}
                            onChange={(e) => patchField(f.key, { optionsText: e.target.value })}
                            placeholder={"Option one\nOption two"}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {fields.length === 0 && (
                  <div className="rounded border border-dashed border-surface-border px-4 py-8 text-center text-sm text-ink-soft">
                    No fields yet — requesters will only fill title, priority and items.
                    {canManage && " Add fields with the buttons above."}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="card p-5">
              <h2 className="mb-2 text-sm font-semibold text-ink">How it works</h2>
              <ul className="list-disc space-y-1.5 pl-5 text-xs text-ink-soft">
                <li>Only <b>Active</b> templates appear in the New Request catalog.</li>
                <li>Field keys must be unique — they identify answers on submitted requests.</li>
                <li>Required fields must be filled before a request can be submitted.</li>
                <li>Removing a field detaches it from old answers (the text is kept).</li>
                <li>Items and attachments are built in — no need to add them as fields.</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
