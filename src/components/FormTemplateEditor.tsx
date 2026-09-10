"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { Icon, StatusBadge } from "@/components/ui";
import { buildFieldConfig, parseFieldConfig } from "@/lib/field-config";

interface FieldDraft {
  key: string;
  id?: string;
  label: string;
  fieldKey: string;
  keyTouched: boolean;
  fieldType: string;
  isRequired: boolean;
  optionsText: string;
  help: string;
  placeholder: string;
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
  Status: string;
}

interface Option {
  id: string;
  name: string;
}

const FIELD_TYPES = [
  { value: "text", label: "Text Input", icon: "text_fields", section: "Basic Input" },
  { value: "textarea", label: "Textarea", icon: "notes", section: "Basic Input" },
  { value: "number", label: "Number", icon: "numbers", section: "Basic Input" },
  { value: "date", label: "Date Picker", icon: "calendar_month", section: "Basic Input" },
  { value: "select", label: "Dropdown", icon: "arrow_drop_down_circle", section: "Selection" },
  { value: "checkbox", label: "Checkbox", icon: "check_box", section: "Selection" },
];

const SECTIONS = ["Basic Input", "Selection"];
const KNOWN_TYPES = FIELD_TYPES.map((t) => t.value);

function typeLabel(v: string): string {
  return FIELD_TYPES.find((t) => t.value === v)?.label ?? v;
}

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

function blankField(type: string): FieldDraft {
  return {
    key: nextKey(),
    label: "",
    fieldKey: "",
    keyTouched: false,
    fieldType: type,
    isRequired: false,
    optionsText: "",
    help: "",
    placeholder: "",
  };
}

function facsimileType(t: string): string {
  if (t === "number") return "number";
  if (t === "date") return "date";
  return "text";
}

/* ---------- Non-interactive field preview shown on the canvas ---------- */
function FieldFacsimile({ f }: { f: FieldDraft }) {
  if (f.fieldType === "checkbox") {
    return (
      <div className="pointer-events-none flex items-center gap-2 pt-1 text-sm text-ink">
        <input type="checkbox" disabled className="h-4 w-4" />
        <span className="font-medium">
          {f.label || "Checkbox"} {f.isRequired && <span className="text-danger">*</span>}
        </span>
      </div>
    );
  }
  return (
    <div className="pointer-events-none">
      <div className="mb-1 block text-sm font-medium text-ink">
        {f.label || <span className="text-ink-faint">Untitled field</span>}{" "}
        {f.isRequired && <span className="text-danger">*</span>}
      </div>
      {f.fieldType === "textarea" ? (
        <textarea
          disabled
          rows={2}
          className="input bg-surface-muted"
          placeholder={f.placeholder || undefined}
        />
      ) : f.fieldType === "select" ? (
        <select disabled className="input bg-surface-muted">
          <option>Select...</option>
        </select>
      ) : (
        <input
          disabled
          type={facsimileType(f.fieldType)}
          className="input bg-surface-muted"
          placeholder={f.placeholder || undefined}
        />
      )}
      {f.help && <p className="mt-1 text-xs text-ink-faint">{f.help}</p>}
    </div>
  );
}

/* ---------- Interactive requester-facing preview (not saved) ---------- */
function LivePreview({
  name,
  description,
  fields,
}: {
  name: string;
  description: string;
  fields: FieldDraft[];
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  return (
    <div>
      <h2 className="text-xl font-bold text-ink">{name || "Untitled Form"}</h2>
      {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
      <div className="my-4 border-b border-dashed border-surface-border" />
      {fields.length === 0 && (
        <p className="py-6 text-center text-sm text-ink-faint">
          No fields yet — requesters will only fill title, priority and items.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {fields.map((f) => {
          const wide = f.fieldType === "textarea";
          const opts =
            f.fieldType === "select"
              ? f.optionsText
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : [];
          return (
            <div key={f.key} className={wide ? "md:col-span-2" : ""}>
              {f.fieldType === "checkbox" ? (
                <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={(vals[f.key] || "") === "true"}
                    onChange={(e) => setVals({ ...vals, [f.key]: e.target.checked ? "true" : "" })}
                  />
                  <span className="font-medium">
                    {f.label || "Checkbox"}{" "}
                    {f.isRequired && <span className="text-danger">*</span>}
                  </span>
                </label>
              ) : (
                <>
                  <label className="label">
                    {f.label || "Untitled field"}{" "}
                    {f.isRequired && <span className="text-danger">*</span>}
                  </label>
                  {f.fieldType === "textarea" ? (
                    <textarea
                      rows={3}
                      className="input"
                      placeholder={f.placeholder || undefined}
                      value={vals[f.key] || ""}
                      onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                    />
                  ) : f.fieldType === "select" ? (
                    <select
                      className="input"
                      value={vals[f.key] || ""}
                      onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                    >
                      <option value="">Select...</option>
                      {opts.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={facsimileType(f.fieldType)}
                      className="input"
                      placeholder={f.placeholder || undefined}
                      value={vals[f.key] || ""}
                      onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                    />
                  )}
                </>
              )}
              {f.help && <p className="mt-1 text-xs text-ink-faint">{f.help}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
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
  const [cats, setCats] = useState<Option[]>([]);
  const [wfs, setWfs] = useState<(Option & { status: string })[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<"field" | "form">("field");
  const [preview, setPreview] = useState(false);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

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
        setWfs((d || []).map((w) => ({ id: w.WFDefinitionID, name: w.Name, status: w.Status })))
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
            (t.Fields || []).map((f) => {
              const cfg = parseFieldConfig(f.Config);
              const known = KNOWN_TYPES.includes(f.FieldType) ? f.FieldType : "text";
              return {
                key: nextKey(),
                id: f.FormFieldID,
                label: f.Label,
                fieldKey: f.FieldKey,
                keyTouched: true,
                fieldType: known,
                isRequired: f.IsRequired,
                optionsText: known === "select" ? cfg.options.join("\n") : "",
                help: cfg.help,
                placeholder: cfg.placeholder,
              };
            })
          );
        })
        .catch(() => setError("Failed to load template"))
        .finally(() => setLoading(false));
    }
  }, [token, isNew, templateId]);

  function selectField(key: string | null) {
    setSelectedKey(key);
    if (key) setSettingsTab("field");
  }

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
    setSelectedKey((cur) => (cur === key ? null : cur));
  }

  function insertField(type: string, idx: number) {
    const f = blankField(type);
    setFields((prev) => {
      const next = [...prev];
      next.splice(Math.min(idx, prev.length), 0, f);
      return next;
    });
    selectField(f.key);
  }

  function handleDrop(e: React.DragEvent, idx: number) {
    e.preventDefault();
    e.stopPropagation();
    const move = e.dataTransfer.getData("application/x-prsys-move-field");
    const add = e.dataTransfer.getData("application/x-prsys-new-field");
    setDropIdx(null);
    if (!canManage) return;
    if (move !== "") {
      const from = Number(move);
      if (Number.isNaN(from)) return;
      setFields((prev) => {
        if (from < 0 || from >= prev.length) return prev;
        let to = idx;
        if (from < to) to -= 1;
        if (from === to) return prev;
        const next = [...prev];
        const [f] = next.splice(from, 1);
        next.splice(to, 0, f);
        return next;
      });
      return;
    }
    if (add !== "" && KNOWN_TYPES.includes(add)) {
      insertField(add, idx);
    }
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
        fields: fields.map((f, i) => ({
          ...(f.id ? { id: f.id } : {}),
          label: f.label.trim(),
          fieldKey: f.fieldKey.trim(),
          fieldType: f.fieldType,
          isRequired: f.isRequired,
          sortOrder: i,
          config: buildFieldConfig({
            options:
              f.fieldType === "select"
                ? f.optionsText
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean)
                : [],
            help: f.help,
            placeholder: f.placeholder,
          }),
        })),
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
  const selected = fields.find((f) => f.key === selectedKey) ?? null;

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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPreview(!preview)}
              className={`inline-flex items-center gap-1.5 rounded border px-4 py-2 text-sm font-semibold ${
                preview
                  ? "border-primary bg-blue-50 text-primary"
                  : "border-surface-border bg-white text-ink-soft hover:border-primary hover:text-primary"
              }`}
            >
              <Icon name="visibility" className="text-[18px]" />
              {preview ? "Exit Preview" : "Preview"}
            </button>
            {canManage && (
              <button
                onClick={save}
                disabled={saving || loading}
                className="btn-primary disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="save" className="text-[18px]" />
                  {saving ? "Saving..." : isNew ? "Create Template" : "Save Changes"}
                </span>
              </button>
            )}
          </div>
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
        <div className="grid items-start gap-4 xl:grid-cols-[230px_minmax(0,1fr)_300px]">
          {/* ---- Field palette ---- */}
          <div className={`card p-4 ${preview ? "pointer-events-none opacity-50" : ""}`}>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-faint">
              Field Types
            </h2>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
              {SECTIONS.map((sec) => (
                <div key={sec} className="col-span-2 xl:col-span-1">
                  <div className="mb-1.5 mt-2 text-xs font-semibold text-ink-soft first:mt-0">
                    {sec}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {FIELD_TYPES.filter((t) => t.section === sec).map((t) => (
                      <div
                        key={t.value}
                        draggable={canManage}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/x-prsys-new-field", t.value);
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => canManage && insertField(t.value, fields.length)}
                        title={canManage ? "Drag onto the canvas, or click to add" : typeLabel(t.value)}
                        className={`flex flex-col items-center gap-1 rounded border border-surface-border bg-white px-2 py-3 text-center ${
                          canManage ? "cursor-grab hover:border-primary hover:text-primary" : ""
                        }`}
                      >
                        <Icon name={t.icon} className="text-[22px] text-ink-soft" />
                        <span className="text-xs font-medium">{t.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-snug text-ink-faint">
              Items and attachments are built into every request — no need to add them as fields.
            </p>
          </div>

          {/* ---- Canvas ---- */}
          <div
            className="card min-h-[420px] p-5 md:p-7"
            onDragOver={(e) => {
              if (!canManage || preview) return;
              e.preventDefault();
              setDropIdx(fields.length);
            }}
            onDrop={(e) => !preview && handleDrop(e, fields.length)}
            onDragLeave={() => setDropIdx(null)}
          >
            {preview ? (
              <>
                <div className="mb-4 rounded bg-blue-50 px-3 py-2 text-xs font-medium text-primary">
                  Preview mode — try the form as a requester. Nothing here is saved.
                </div>
                <LivePreview name={name} description={description} fields={fields} />
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold text-ink">{name || "Untitled Form"}</h2>
                {description ? (
                  <p className="mt-1 text-sm text-ink-soft">{description}</p>
                ) : (
                  <p className="mt-1 text-sm italic text-ink-faint">
                    Add a description in Form Settings — it shows on the catalog card.
                  </p>
                )}
                <div className="my-4 border-b border-dashed border-surface-border" />
                <div className="space-y-1.5">
                  {fields.map((f, i) => {
                    const active = f.key === selectedKey;
                    return (
                      <div key={f.key}>
                        {dropIdx === i && <div className="mb-1.5 h-0.5 rounded bg-primary" />}
                        <div
                          draggable={canManage}
                          onDragStart={(e) => {
                            e.dataTransfer.setData("application/x-prsys-move-field", String(i));
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragOver={(e) => {
                            if (!canManage) return;
                            e.preventDefault();
                            e.stopPropagation();
                            setDropIdx(i);
                          }}
                          onDrop={(e) => handleDrop(e, i)}
                          onDragEnd={() => setDropIdx(null)}
                          onClick={() => selectField(f.key)}
                          title={canManage ? "Click to edit — drag to reorder" : undefined}
                          className={`relative rounded-lg border-2 p-3 pt-4 ${
                            active
                              ? "border-primary bg-blue-50/40"
                              : "border-transparent bg-white hover:border-surface-border"
                          } ${canManage ? "cursor-grab" : ""}`}
                        >
                          {active && (
                            <>
                              <span className="absolute -top-2.5 left-3 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                                {typeLabel(f.fieldType)}
                              </span>
                              {canManage && (
                                <span
                                  className="absolute right-2 top-2 flex items-center gap-0.5"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    className="icon-btn !h-7 !w-7 bg-white shadow-sm"
                                    disabled={i === 0}
                                    onClick={() => moveField(f.key, -1)}
                                    aria-label="Move up"
                                  >
                                    <Icon name="arrow_upward" className="text-[18px]" />
                                  </button>
                                  <button
                                    className="icon-btn !h-7 !w-7 bg-white shadow-sm"
                                    disabled={i === fields.length - 1}
                                    onClick={() => moveField(f.key, 1)}
                                    aria-label="Move down"
                                  >
                                    <Icon name="arrow_downward" className="text-[18px]" />
                                  </button>
                                  <button
                                    className="icon-btn !h-7 !w-7 bg-white text-danger shadow-sm hover:bg-red-50"
                                    onClick={() => removeField(f.key)}
                                    aria-label="Remove field"
                                  >
                                    <Icon name="delete" className="text-[18px]" />
                                  </button>
                                </span>
                              )}
                            </>
                          )}
                          <FieldFacsimile f={f} />
                        </div>
                      </div>
                    );
                  })}
                  {dropIdx === fields.length && fields.length > 0 && (
                    <div className="h-0.5 rounded bg-primary" />
                  )}
                  {fields.length === 0 && (
                    <div className="rounded-lg border-2 border-dashed border-surface-border px-4 py-14 text-center">
                      <Icon name="add_circle" className="text-[28px] text-ink-faint" />
                      <div className="mt-2 text-sm font-medium text-ink-soft">
                        Drag &amp; Drop fields here
                      </div>
                      <div className="text-xs text-ink-faint">
                        {canManage
                          ? "or click a field type to add it"
                          : "this template has no custom fields"}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ---- Settings panel ---- */}
          <div className="card overflow-hidden">
            <div className="flex border-b border-surface-border text-sm font-semibold">
              <button
                onClick={() => setSettingsTab("field")}
                className={`flex-1 px-3 py-2.5 ${
                  settingsTab === "field"
                    ? "border-b-2 border-primary text-primary"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                Field Settings
              </button>
              <button
                onClick={() => setSettingsTab("form")}
                className={`flex-1 px-3 py-2.5 ${
                  settingsTab === "form"
                    ? "border-b-2 border-primary text-primary"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                Form Settings
              </button>
            </div>
            <div className="space-y-4 p-4">
              {settingsTab === "field" ? (
                selected ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 items-center justify-center rounded bg-blue-100 text-primary">
                        <Icon
                          name={FIELD_TYPES.find((t) => t.value === selected.fieldType)?.icon || "edit"}
                          className="text-[20px]"
                        />
                      </span>
                      <div>
                        <div className="text-sm font-semibold text-ink">
                          {typeLabel(selected.fieldType)}
                        </div>
                        <div className="font-mono text-[11px] text-ink-faint">
                          {selected.fieldKey || "no key yet"}
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="label">Field Label</label>
                      <input
                        className="input"
                        value={selected.label}
                        disabled={ro}
                        onChange={(e) => {
                          const label = e.target.value;
                          patchField(selected.key, {
                            label,
                            ...(selected.keyTouched ? {} : { fieldKey: slugify(label) }),
                          });
                        }}
                        placeholder="e.g. Justification"
                      />
                    </div>
                    <div>
                      <label className="label">Key (unique)</label>
                      <div className="flex gap-1.5">
                        <input
                          className="input font-mono text-xs"
                          value={selected.fieldKey}
                          disabled={ro}
                          onChange={(e) =>
                            patchField(selected.key, { fieldKey: e.target.value, keyTouched: true })
                          }
                          placeholder="auto-generated"
                        />
                        {canManage && (
                          <button
                            className="icon-btn shrink-0"
                            title="Regenerate from label"
                            onClick={() =>
                              patchField(selected.key, { fieldKey: slugify(selected.label) })
                            }
                          >
                            <Icon name="refresh" className="text-[18px]" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="label">Type</label>
                      <select
                        className="input"
                        value={selected.fieldType}
                        disabled={ro}
                        onChange={(e) => patchField(selected.key, { fieldType: e.target.value })}
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-ink">Required field</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={selected.isRequired}
                        disabled={ro}
                        onClick={() => patchField(selected.key, { isRequired: !selected.isRequired })}
                        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                          selected.isRequired ? "bg-primary" : "bg-gray-300"
                        } disabled:opacity-50`}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                            selected.isRequired ? "left-[18px]" : "left-0.5"
                          }`}
                        />
                      </button>
                    </div>
                    <div>
                      <label className="label">
                        Help Text{" "}
                        <span className="float-right font-normal text-ink-faint">Optional</span>
                      </label>
                      <textarea
                        rows={2}
                        className="input"
                        value={selected.help}
                        disabled={ro}
                        onChange={(e) => patchField(selected.key, { help: e.target.value })}
                        placeholder="Shown under the input to guide the requester"
                      />
                    </div>
                    {["text", "textarea", "number"].includes(selected.fieldType) && (
                      <div>
                        <label className="label">
                          Placeholder{" "}
                          <span className="float-right font-normal text-ink-faint">Optional</span>
                        </label>
                        <input
                          className="input"
                          value={selected.placeholder}
                          disabled={ro}
                          onChange={(e) => patchField(selected.key, { placeholder: e.target.value })}
                          placeholder="e.g. Explain the need..."
                        />
                      </div>
                    )}
                    {selected.fieldType === "select" && (
                      <div>
                        <label className="label">Dropdown options (one per line)</label>
                        <textarea
                          rows={4}
                          className="input"
                          value={selected.optionsText}
                          disabled={ro}
                          onChange={(e) => patchField(selected.key, { optionsText: e.target.value })}
                          placeholder={"Option one\nOption two"}
                        />
                      </div>
                    )}
                    {canManage && (
                      <button
                        onClick={() => removeField(selected.key)}
                        className="flex w-full items-center justify-center gap-1.5 rounded border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-danger hover:bg-red-50"
                      >
                        <Icon name="delete" className="text-[18px]" /> Remove
                      </button>
                    )}
                  </>
                ) : (
                  <div className="py-10 text-center text-sm text-ink-soft">
                    <Icon name="touch_app" className="text-[28px] text-ink-faint" />
                    <div className="mt-2">Select a field on the canvas to edit its settings.</div>
                  </div>
                )
              ) : (
                <>
                  <div>
                    <label className="label">
                      Template Name <span className="text-danger">*</span>
                    </label>
                    <input
                      className="input"
                      value={name}
                      disabled={ro}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Raw Material Request"
                    />
                  </div>
                  <div>
                    <label className="label">Description</label>
                    <textarea
                      rows={3}
                      className="input"
                      value={description}
                      disabled={ro}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Shown on the New Request catalog card"
                    />
                  </div>
                  <div>
                    <label className="label">Category</label>
                    <select
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
                    <label className="label">Approval Workflow</label>
                    <select
                      className="input"
                      value={workflowId}
                      disabled={ro}
                      onChange={(e) => setWorkflowId(e.target.value)}
                    >
                      <option value="">No workflow (auto-approve)</option>
                      {wfs.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                          {w.status !== "ACTIVE" ? ` (${w.status})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Status</label>
                    <select
                      className="input"
                      value={status}
                      disabled={ro}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="DRAFT">Draft</option>
                      <option value="ACTIVE">Active</option>
                    </select>
                  </div>
                  <div className="rounded bg-surface-muted p-3">
                    <div className="mb-1.5 text-xs font-semibold text-ink">How it works</div>
                    <ul className="list-disc space-y-1 pl-4 text-[11px] leading-snug text-ink-soft">
                      <li>Only Active templates appear in the New Request catalog.</li>
                      <li>Field keys must be unique — they identify answers.</li>
                      <li>Required fields block submission until filled.</li>
                      <li>Removing a field detaches it from old answers (text is kept).</li>
                    </ul>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
