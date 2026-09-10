"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { Icon, StatusBadge } from "@/components/ui";
import {
  FIELD_TYPES,
  FIELD_TYPE_GROUPS,
  buildFieldConfig,
  fieldTypeIcon,
  fieldTypeLabel,
  isKnownFieldType,
  CURRENCIES,
  currencyByCode,
  formatMoney,
  parseFieldConfig,
  parseMultiValue,
} from "@/lib/field-config";
import { formatRequestId, validateIdFormat } from "@/lib/request-ids";

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
  min: string;
  max: string;
  minLength: string;
  maxLength: string;
  maxFiles: string;
  maxSizeMB: string;
  accept: string;
  currency: string;
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

interface LoadedPerm {
  FormPermissionID: string;
  DEPID: string | null;
  GroupID: string | null;
  UserID: string | null;
  DEP: { Name: string } | null;
  Group: { Name: string } | null;
  User: { Name: string } | null;
}

interface LoadedTemplate {
  FormTemplateID: string;
  Name: string;
  Description: string | null;
  FormCategoryID: string | null;
  WFDefinitionID: string | null;
  Status: string;
  Fields: LoadedField[];
  OwnerDEPID?: string | null;
  OwnerGroupID?: string | null;
  FormPerms?: LoadedPerm[];
  IdPrefix?: string | null;
  IdSeparator?: string | null;
  IdPadding?: number | null;
  IdIncludeYear?: boolean | null;
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

interface DepRow {
  DEPID: string;
  Name: string;
}

interface GroupRow {
  id: string;
  name: string;
}

interface UserRow {
  UserID: string;
  Name: string;
  Email: string;
}

interface Option {
  id: string;
  name: string;
}

interface VisChip {
  key: string;
  depId: string | null;
  groupId: string | null;
  userId: string | null;
  kind: "dep" | "group" | "user";
  label: string;
}

const OPTION_TYPES = ["select", "radio", "multiselect"];
const PLACEHOLDER_TYPES = ["text", "textarea", "email", "tel", "url", "number", "currency"];
const MINMAX_TYPES = ["number", "currency"];
const LENGTH_TYPES = ["text", "textarea"];

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
    min: "",
    max: "",
    minLength: "",
    maxLength: "",
    maxFiles: "",
    maxSizeMB: "",
    accept: "",
    currency: "",
  };
}

function inputType(t: string): string {
  if (t === "number" || t === "currency") return "number";
  if (t === "date") return "date";
  if (t === "time") return "time";
  if (t === "datetime") return "datetime-local";
  if (t === "email" || t === "tel" || t === "url") return t;
  return "text";
}

function optionsOf(f: FieldDraft): string[] {
  return f.optionsText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ---------- Non-interactive field preview shown on the canvas ---------- */
function FieldFacsimile({ f }: { f: FieldDraft }) {
  if (f.fieldType === "section") {
    return (
      <div className="pointer-events-none border-l-2 border-primary pl-3">
        <div className="text-base font-bold text-ink">
          {f.label || <span className="text-ink-faint">Untitled section</span>}
        </div>
        {f.help && <p className="mt-0.5 text-xs text-ink-soft">{f.help}</p>}
      </div>
    );
  }
  if (f.fieldType === "file") {
    return (
      <div className="pointer-events-none">
        <div className="mb-1 block text-sm font-medium text-ink">
          {f.label || <span className="text-ink-faint">Untitled field</span>}{" "}
          {f.isRequired && <span className="text-danger">*</span>}
        </div>
        <div className="flex items-center justify-center gap-2 rounded border border-dashed border-surface-border bg-surface-muted px-4 py-4 text-sm text-ink-soft">
          <Icon name="attach_file" className="text-[20px]" />
          Choose files...
        </div>
        {f.help && <p className="mt-1 text-xs text-ink-faint">{f.help}</p>}
      </div>
    );
  }
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
  if (f.fieldType === "radio") {
    const opts = optionsOf(f);
    return (
      <div className="pointer-events-none">
        <div className="mb-1 block text-sm font-medium text-ink">
          {f.label || <span className="text-ink-faint">Untitled field</span>}{" "}
          {f.isRequired && <span className="text-danger">*</span>}
        </div>
        <div className="space-y-1">
          {(opts.length > 0 ? opts.slice(0, 3) : ["Option"]).map((o) => (
            <label key={o} className="flex items-center gap-2 text-sm text-ink-soft">
              <input type="radio" disabled className="h-4 w-4" /> {o}
            </label>
          ))}
          {opts.length > 3 && (
            <div className="text-xs text-ink-faint">+{opts.length - 3} more</div>
          )}
        </div>
        {f.help && <p className="mt-1 text-xs text-ink-faint">{f.help}</p>}
      </div>
    );
  }
  if (
    f.fieldType === "select" ||
    f.fieldType === "multiselect" ||
    f.fieldType === "user" ||
    f.fieldType === "department"
  ) {
    const ph =
      f.fieldType === "multiselect"
        ? "Select one or more..."
        : f.fieldType === "user"
          ? "Select user..."
          : f.fieldType === "department"
            ? "Select department..."
            : "Select...";
    return (
      <div className="pointer-events-none">
        <div className="mb-1 block text-sm font-medium text-ink">
          {f.label || <span className="text-ink-faint">Untitled field</span>}{" "}
          {f.isRequired && <span className="text-danger">*</span>}
        </div>
        <select disabled className="input bg-surface-muted">
          <option>{ph}</option>
        </select>
        {f.help && <p className="mt-1 text-xs text-ink-faint">{f.help}</p>}
      </div>
    );
  }
  const fcur = f.fieldType === "currency" ? currencyByCode(f.currency) || null : null;
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
      ) : fcur ? (
        <div className="relative">
          <input
            disabled
            type="number"
            className="input bg-surface-muted !pr-14"
            placeholder={f.placeholder || undefined}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-soft">
            {fcur.symbol}
          </span>
        </div>
      ) : (
        <input
          disabled
          type={inputType(f.fieldType)}
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
  users,
  departments,
}: {
  name: string;
  description: string;
  fields: FieldDraft[];
  users: Option[];
  departments: Option[];
}) {
  const [vals, setVals] = useState<Record<string, string>>({});

  function toggleMulti(key: string, opt: string) {
    const cur = parseMultiValue(vals[key] || "");
    const next = cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt];
    setVals({ ...vals, [key]: JSON.stringify(next) });
  }

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
          const wide = f.fieldType === "textarea" || f.fieldType === "section" || f.fieldType === "multiselect" || f.fieldType === "file";
          const opts = OPTION_TYPES.includes(f.fieldType) ? optionsOf(f) : [];
          const numAttrs =
            MINMAX_TYPES.includes(f.fieldType)
              ? {
                  min: f.min.trim() || undefined,
                  max: f.max.trim() || undefined,
                  step: f.fieldType === "currency" ? "0.01" : "any",
                }
              : {};
          const lenAttrs = LENGTH_TYPES.includes(f.fieldType)
            ? {
                minLength: f.minLength.trim() ? Number(f.minLength) : undefined,
                maxLength: f.maxLength.trim() ? Number(f.maxLength) : undefined,
              }
            : {};
          const pcur = f.fieldType === "currency" ? currencyByCode(f.currency) || null : null;
          return (
            <div key={f.key} className={wide ? "md:col-span-2" : ""}>
              {f.fieldType === "section" ? (
                <div className="border-l-2 border-primary pl-3">
                  <div className="text-base font-bold text-ink">{f.label || "Untitled section"}</div>
                  {f.help && <p className="mt-0.5 text-xs text-ink-soft">{f.help}</p>}
                </div>
              ) : f.fieldType === "file" ? (
                <>
                  <label className="label">
                    {f.label || "Untitled field"}{" "}
                    {f.isRequired && <span className="text-danger">*</span>}
                  </label>
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-surface-border bg-surface px-4 py-4 text-sm font-medium text-ink-soft transition-colors hover:border-primary hover:text-primary-dark">
                    <Icon name="attach_file" className="text-[20px]" />
                    {(() => {
                      const n = (vals[f.key] || "").split("|").filter(Boolean).length;
                      return n === 0 ? "Choose files..." : `${n} file${n === 1 ? "" : "s"} picked (preview only)`;
                    })()}
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) =>
                        setVals({
                          ...vals,
                          [f.key]: Array.from(e.target.files || [])
                            .map((x) => x.name)
                            .join("|"),
                        })
                      }
                    />
                  </label>
                  {f.help && <p className="mt-1 text-xs text-ink-faint">{f.help}</p>}
                </>
              ) : f.fieldType === "checkbox" ? (
                <>
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
                  {f.help && <p className="mt-1 text-xs text-ink-faint">{f.help}</p>}
                </>
              ) : f.fieldType === "radio" ? (
                <>
                  <span className="label">
                    {f.label || "Untitled field"}{" "}
                    {f.isRequired && <span className="text-danger">*</span>}
                  </span>
                  <div className="space-y-1.5 pt-1">
                    {opts.length === 0 && (
                      <p className="text-xs italic text-ink-faint">No options defined yet</p>
                    )}
                    {opts.map((o) => (
                      <label key={o} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                        <input
                          type="radio"
                          name={f.key}
                          className="h-4 w-4"
                          checked={(vals[f.key] || "") === o}
                          onChange={() => setVals({ ...vals, [f.key]: o })}
                        />
                        {o}
                      </label>
                    ))}
                  </div>
                  {f.help && <p className="mt-1 text-xs text-ink-faint">{f.help}</p>}
                </>
              ) : f.fieldType === "multiselect" ? (
                <>
                  <span className="label">
                    {f.label || "Untitled field"}{" "}
                    {f.isRequired && <span className="text-danger">*</span>}
                  </span>
                  <div className="space-y-1.5 rounded border border-surface-border p-3 pt-2">
                    {opts.length === 0 && (
                      <p className="text-xs italic text-ink-faint">No options defined yet</p>
                    )}
                    {opts.map((o) => (
                      <label key={o} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={parseMultiValue(vals[f.key] || "").includes(o)}
                          onChange={() => toggleMulti(f.key, o)}
                        />
                        {o}
                      </label>
                    ))}
                  </div>
                  {f.help && <p className="mt-1 text-xs text-ink-faint">{f.help}</p>}
                </>
              ) : f.fieldType === "user" || f.fieldType === "department" ? (
                <>
                  <label className="label">
                    {f.label || "Untitled field"}{" "}
                    {f.isRequired && <span className="text-danger">*</span>}
                  </label>
                  <select
                    className="input"
                    value={vals[f.key] || ""}
                    onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                  >
                    <option value="">
                      {f.fieldType === "user" ? "Select user..." : "Select department..."}
                    </option>
                    {(f.fieldType === "user" ? users : departments).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                  {f.help && <p className="mt-1 text-xs text-ink-faint">{f.help}</p>}
                </>
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
                      {...lenAttrs}
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
                  ) : pcur ? (
                    <div>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.01"
                          className="input !pr-14"
                          placeholder={f.placeholder || undefined}
                          value={vals[f.key] || ""}
                          onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                          {...numAttrs}
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-soft">
                          {pcur.symbol}
                        </span>
                      </div>
                      {(vals[f.key] || "").trim() !== "" && (
                        <p className="mt-1 text-xs font-medium text-primary-dark">
                          {formatMoney(vals[f.key] || "", pcur.code)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <input
                      type={inputType(f.fieldType)}
                      className="input"
                      placeholder={f.placeholder || undefined}
                      value={vals[f.key] || ""}
                      onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                      {...numAttrs}
                      {...lenAttrs}
                    />
                  )}
                  {f.help && <p className="mt-1 text-xs text-ink-faint">{f.help}</p>}
                </>
              )}
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
  const [slaPolicyId, setSlaPolicyId] = useState("");
  const [slaPolicies, setSlaPolicies] = useState<(Option & { isDefault?: boolean })[]>([]);
  const [status, setStatus] = useState("DRAFT");
  const [fields, setFields] = useState<FieldDraft[]>([]);
  const [cats, setCats] = useState<Option[]>([]);
  const [wfs, setWfs] = useState<(Option & { status: string })[]>([]);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [users, setUsers] = useState<Option[]>([]);
  const [ownerType, setOwnerType] = useState<"none" | "dep" | "group">("none");
  const [ownerDepId, setOwnerDepId] = useState("");
  const [ownerGroupId, setOwnerGroupId] = useState("");
  const [visMode, setVisMode] = useState<"public" | "restricted">("public");
  const [visChips, setVisChips] = useState<VisChip[]>([]);
  const [visKind, setVisKind] = useState<"dep" | "group" | "user">("dep");
  const [visPick, setVisPick] = useState("");
  const [idPrefix, setIdPrefix] = useState("");
  const [idSeparator, setIdSeparator] = useState("");
  const [idPadding, setIdPadding] = useState("0");
  const [idIncludeYear, setIdIncludeYear] = useState(false);
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
    fetch("/api/sla-policies", { headers: h })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: { id: string; name: string; isDefault: boolean }[]) =>
        setSlaPolicies((Array.isArray(d) ? d : []).map((x) => ({ id: x.id, name: x.name, isDefault: x.isDefault })))
      )
      .catch(() => setSlaPolicies([]));
    fetch("/api/departments", { headers: h })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: DepRow[]) =>
        setDepartments((d || []).map((x) => ({ id: x.DEPID, name: x.Name })))
      )
      .catch(() => setDepartments([]));
    fetch("/api/groups", { headers: h })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: GroupRow[]) => setGroups((d || []).map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => setGroups([]));
    fetch("/api/users/lookup", { headers: h })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: UserRow[]) =>
        setUsers((d || []).map((x) => ({ id: x.UserID, name: `${x.Name} (${x.Email})` })))
      )
      .catch(() => setUsers([]));
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
          setSlaPolicyId((t as { SLAPolicyID?: string | null }).SLAPolicyID ?? "");
          setStatus(t.Status);
          setOwnerType(t.OwnerGroupID ? "group" : t.OwnerDEPID ? "dep" : "none");
          setOwnerDepId(t.OwnerDEPID ?? "");
          setOwnerGroupId(t.OwnerGroupID ?? "");
          setIdPrefix(t.IdPrefix ?? "");
          setIdSeparator(t.IdSeparator ?? "");
          setIdPadding(String(t.IdPadding ?? 0));
          setIdIncludeYear(t.IdIncludeYear ?? false);
          const perms = t.FormPerms ?? [];
          if (perms.length === 0) {
            setVisMode("public");
            setVisChips([]);
          } else {
            setVisMode("restricted");
            setVisChips(
              perms.map((p) => ({
                key: `${p.DEPID ?? ""}|${p.GroupID ?? ""}|${p.UserID ?? ""}`,
                depId: p.DEPID,
                groupId: p.GroupID,
                userId: p.UserID,
                kind: p.DEPID ? "dep" : p.GroupID ? "group" : "user",
                label: p.DEP?.Name ?? p.Group?.Name ?? p.User?.Name ?? "Unknown",
              }))
            );
          }
          setFields(
            (t.Fields || []).map((f) => {
              const cfg = parseFieldConfig(f.Config);
              const known = isKnownFieldType(f.FieldType) ? f.FieldType : "text";
              return {
                key: nextKey(),
                id: f.FormFieldID,
                label: f.Label,
                fieldKey: f.FieldKey,
                keyTouched: true,
                fieldType: known,
                isRequired: known === "section" ? false : f.IsRequired,
                optionsText: OPTION_TYPES.includes(known) ? cfg.options.join("\n") : "",
                help: cfg.help,
                placeholder: cfg.placeholder,
                min: cfg.min,
                max: cfg.max,
                minLength: cfg.minLength,
                maxLength: cfg.maxLength,
                maxFiles: cfg.maxFiles,
                maxSizeMB: cfg.maxSizeMB,
                accept: cfg.accept,
                currency: cfg.currency,
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
    if (add !== "" && isKnownFieldType(add)) {
      insertField(add, idx);
    }
  }

  function addVisChip() {
    if (!visPick) return;
    const depId = visKind === "dep" ? visPick : null;
    const groupId = visKind === "group" ? visPick : null;
    const userId = visKind === "user" ? visPick : null;
    const key = `${depId ?? ""}|${groupId ?? ""}|${userId ?? ""}`;
    if (visChips.some((c) => c.key === key)) {
      setError("That entry is already in the list");
      return;
    }
    const src = visKind === "dep" ? departments : visKind === "group" ? groups : users;
    const found = src.find((o) => o.id === visPick);
    setVisChips([
      ...visChips,
      { key, depId, groupId, userId, kind: visKind, label: found?.name ?? "Unknown" },
    ]);
    setVisPick("");
    setError("");
  }

  async function save() {
    setError("");
    if (!name.trim()) {
      setError("Template name is required");
      return;
    }
    if (ownerType === "dep" && !ownerDepId) {
      setError("Pick an owner department — or set owner to None");
      return;
    }
    if (ownerType === "group" && !ownerGroupId) {
      setError("Pick an owner group — or set owner to None");
      return;
    }
    if (visMode === "restricted" && visChips.length === 0) {
      setError("Restricted visibility needs at least one department, group or user — or switch back to Public");
      return;
    }
    const idPrefixNorm = idPrefix.trim() === "" ? null : idPrefix.trim().toUpperCase();
    const idPadNum = idPadding.trim() === "" ? 0 : Number(idPadding);
    const idErr = validateIdFormat(idPrefixNorm, idSeparator, idPadNum, idIncludeYear);
    if (idErr) {
      setError(idErr);
      return;
    }
    // resolve keys (sections get an auto key when left empty) and validate
    const resolvedKeys = fields.map((f, i) =>
      f.fieldType === "section" && !f.fieldKey.trim() ? `section_${i + 1}` : f.fieldKey.trim()
    );
    const seen = new Set<string>();
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!f.label.trim()) {
        setError(f.fieldType === "section" ? "Every section needs a title" : "Every field needs a label");
        return;
      }
      const k = resolvedKeys[i];
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
      if (MINMAX_TYPES.includes(f.fieldType)) {
        if (f.min.trim() !== "" && !Number.isFinite(Number(f.min))) {
          setError(`Field "${f.label}": Min must be a number`);
          return;
        }
        if (f.max.trim() !== "" && !Number.isFinite(Number(f.max))) {
          setError(`Field "${f.label}": Max must be a number`);
          return;
        }
      }
      if (LENGTH_TYPES.includes(f.fieldType)) {
        for (const [nm, v] of [
          ["Min length", f.minLength],
          ["Max length", f.maxLength],
        ] as const) {
          if (v.trim() !== "" && !/^\d+$/.test(v.trim())) {
            setError(`Field "${f.label}": ${nm} must be a whole number`);
            return;
          }
        }
      }
      if (f.fieldType === "file") {
        if (f.maxFiles.trim() !== "" && !/^\d+$/.test(f.maxFiles.trim())) {
          setError(`Field "${f.label}": Max files must be a whole number`);
          return;
        }
        if (f.maxSizeMB.trim() !== "" && !/^\d+(\.\d+)?$/.test(f.maxSizeMB.trim())) {
          setError(`Field "${f.label}": Max size must be a number`);
          return;
        }
        if (f.accept.trim() !== "" && !/^[A-Za-z0-9.,\s]+$/.test(f.accept)) {
          setError(`Field "${f.label}": Allowed types must be comma-separated extensions (e.g. pdf, jpg)`);
          return;
        }
      }
      if (f.fieldType === "currency" && f.currency && !currencyByCode(f.currency)) {
        setError(`Field "${f.label}": Unknown currency`);
        return;
      }
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        formCategoryId: categoryId || null,
        wfDefinitionId: workflowId || null,
        status,
        ownerDepId: ownerType === "dep" ? ownerDepId || null : null,
        ownerGroupId: ownerType === "group" ? ownerGroupId || null : null,
        slaPolicyId: slaPolicyId || null,
        idPrefix: idPrefixNorm,
        idSeparator: idSeparator || null,
        idPadding: idPadNum,
        idIncludeYear,
        visibility:
          visMode === "restricted"
            ? visChips.map((c) => ({ depId: c.depId, groupId: c.groupId, userId: c.userId }))
            : [],
        fields: fields.map((f, i) => ({
          ...(f.id ? { id: f.id } : {}),
          label: f.label.trim(),
          fieldKey: resolvedKeys[i],
          fieldType: f.fieldType,
          isRequired: f.fieldType === "section" ? false : f.isRequired,
          sortOrder: i,
          config: buildFieldConfig({
            options: OPTION_TYPES.includes(f.fieldType) ? optionsOf(f) : [],
            help: f.help,
            placeholder: PLACEHOLDER_TYPES.includes(f.fieldType) ? f.placeholder : "",
            min: MINMAX_TYPES.includes(f.fieldType) ? f.min : "",
            max: MINMAX_TYPES.includes(f.fieldType) ? f.max : "",
            minLength: LENGTH_TYPES.includes(f.fieldType) ? f.minLength : "",
            maxLength: LENGTH_TYPES.includes(f.fieldType) ? f.maxLength : "",
            maxFiles: f.fieldType === "file" ? f.maxFiles : "",
            maxSizeMB: f.fieldType === "file" ? f.maxSizeMB : "",
            accept: f.fieldType === "file" ? f.accept : "",
            currency: f.fieldType === "currency" ? f.currency : "",
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

  const idPreview = (() => {
    const p = idPrefix.trim().toUpperCase();
    if (p === "") return "";
    const pad = idPadding.trim() === "" ? 0 : Number(idPadding);
    if (validateIdFormat(p, idSeparator, pad, idIncludeYear)) return "";
    const cfg = { prefix: p, separator: idSeparator, padding: pad, includeYear: idIncludeYear };
    const y = new Date().getFullYear();
    return `${formatRequestId(cfg, y, 1)} -> ${formatRequestId(cfg, y, 2)} ...`;
  })();
  const ro = !canManage;
  const selected = fields.find((f) => f.key === selectedKey) ?? null;
  const visOptions = visKind === "dep" ? departments : visKind === "group" ? groups : users;

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
              {FIELD_TYPE_GROUPS.map((sec) => (
                <div key={sec} className="col-span-2 xl:col-span-1">
                  <div className="mb-1.5 mt-2 text-xs font-semibold text-ink-soft first:mt-0">
                    {sec}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {FIELD_TYPES.filter((t) => t.group === sec).map((t) => (
                      <div
                        key={t.value}
                        draggable={canManage}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/x-prsys-new-field", t.value);
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => canManage && insertField(t.value, fields.length)}
                        title={canManage ? "Drag onto the canvas, or click to add" : fieldTypeLabel(t.value)}
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
                <LivePreview
                  name={name}
                  description={description}
                  fields={fields}
                  users={users}
                  departments={departments}
                />
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
                                {fieldTypeLabel(f.fieldType)}
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
                        <Icon name={fieldTypeIcon(selected.fieldType)} className="text-[20px]" />
                      </span>
                      <div>
                        <div className="text-sm font-semibold text-ink">
                          {fieldTypeLabel(selected.fieldType)}
                        </div>
                        <div className="font-mono text-[11px] text-ink-faint">
                          {selected.fieldKey || "no key yet"}
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="label">
                        {selected.fieldType === "section" ? "Section Title" : "Field Label"}
                      </label>
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
                        placeholder={selected.fieldType === "section" ? "e.g. Delivery Details" : "e.g. Justification"}
                      />
                    </div>
                    {selected.fieldType !== "section" && (
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
                    )}
                    <div>
                      <label className="label">Type</label>
                      <select
                        className="input"
                        value={selected.fieldType}
                        disabled={ro}
                        onChange={(e) => patchField(selected.key, { fieldType: e.target.value })}
                      >
                        {FIELD_TYPE_GROUPS.map((g) => (
                          <optgroup key={g} label={g}>
                            {FIELD_TYPES.filter((t) => t.group === g).map((t) => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                    {selected.fieldType !== "section" && (
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
                    )}
                    <div>
                      <label className="label">
                        {selected.fieldType === "section" ? "Description" : "Help Text"}{" "}
                        <span className="float-right font-normal text-ink-faint">Optional</span>
                      </label>
                      <textarea
                        rows={2}
                        className="input"
                        value={selected.help}
                        disabled={ro}
                        onChange={(e) => patchField(selected.key, { help: e.target.value })}
                        placeholder={
                          selected.fieldType === "section"
                            ? "Shown under the section title"
                            : "Shown under the input to guide the requester"
                        }
                      />
                    </div>
                    {PLACEHOLDER_TYPES.includes(selected.fieldType) && (
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
                    {MINMAX_TYPES.includes(selected.fieldType) && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="label">Min</label>
                          <input
                            type="number"
                            step="any"
                            className="input"
                            value={selected.min}
                            disabled={ro}
                            onChange={(e) => patchField(selected.key, { min: e.target.value })}
                            placeholder="No min"
                          />
                        </div>
                        <div>
                          <label className="label">Max</label>
                          <input
                            type="number"
                            step="any"
                            className="input"
                            value={selected.max}
                            disabled={ro}
                            onChange={(e) => patchField(selected.key, { max: e.target.value })}
                            placeholder="No max"
                          />
                        </div>
                      </div>
                    )}
                    {LENGTH_TYPES.includes(selected.fieldType) && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="label">Min length</label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            className="input"
                            value={selected.minLength}
                            disabled={ro}
                            onChange={(e) => patchField(selected.key, { minLength: e.target.value })}
                            placeholder="—"
                          />
                        </div>
                        <div>
                          <label className="label">Max length</label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            className="input"
                            value={selected.maxLength}
                            disabled={ro}
                            onChange={(e) => patchField(selected.key, { maxLength: e.target.value })}
                            placeholder="—"
                          />
                        </div>
                      </div>
                    )}
                    {selected.fieldType === "file" && (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="label">Max files</label>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              className="input"
                              value={selected.maxFiles}
                              disabled={ro}
                              onChange={(e) => patchField(selected.key, { maxFiles: e.target.value })}
                              placeholder="5"
                            />
                          </div>
                          <div>
                            <label className="label">Max MB / file</label>
                            <input
                              type="number"
                              min="1"
                              step="any"
                              className="input"
                              value={selected.maxSizeMB}
                              disabled={ro}
                              onChange={(e) => patchField(selected.key, { maxSizeMB: e.target.value })}
                              placeholder="10"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="label">
                            Allowed types{" "}
                            <span className="float-right font-normal text-ink-faint">Optional</span>
                          </label>
                          <input
                            className="input font-mono text-xs"
                            value={selected.accept}
                            disabled={ro}
                            onChange={(e) => patchField(selected.key, { accept: e.target.value })}
                            placeholder="e.g. pdf, jpg, png (empty = all)"
                          />
                        </div>
                      </>
                    )}
                    {selected.fieldType === "currency" && (
                      <div>
                        <label className="label">Currency</label>
                        <select
                          className="input"
                          value={selected.currency}
                          disabled={ro}
                          onChange={(e) => patchField(selected.key, { currency: e.target.value })}
                        >
                          <option value="">No currency (plain number)</option>
                          {CURRENCIES.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.code} — {c.nameAr} ({c.name})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {OPTION_TYPES.includes(selected.fieldType) && (
                      <div>
                        <label className="label">Options (one per line)</label>
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
                    <label className="label">SLA Policy</label>
                    <select
                      className="input"
                      value={slaPolicyId}
                      disabled={ro}
                      onChange={(e) => setSlaPolicyId(e.target.value)}
                    >
                      <option value="">Platform default</option>
                      {slaPolicies.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.isDefault ? " ★" : ""}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-ink-faint">
                      Response & resolution deadlines (TTA/TTR) applied to requests of this form, by priority.
                    </p>
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

                  {/* ---- Request ID format ---- */}
                  <div className="rounded border border-surface-border p-3">
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-soft">
                      Request ID Format
                    </div>
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="label">Prefix</label>
                          <input
                            className="input font-mono uppercase"
                            value={idPrefix}
                            disabled={ro}
                            maxLength={10}
                            onChange={(e) => setIdPrefix(e.target.value)}
                            placeholder="e.g. PR"
                          />
                        </div>
                        <div>
                          <label className="label">Separator</label>
                          <input
                            className="input font-mono"
                            value={idSeparator}
                            disabled={ro}
                            maxLength={3}
                            onChange={(e) => setIdSeparator(e.target.value)}
                            placeholder="(none)"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 items-end gap-2">
                        <div>
                          <label className="label">Padding</label>
                          <input
                            type="number"
                            min="0"
                            max="10"
                            step="1"
                            className="input"
                            value={idPadding}
                            disabled={ro}
                            onChange={(e) => setIdPadding(e.target.value)}
                          />
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 pb-2 text-xs font-medium text-ink">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={idIncludeYear}
                            disabled={ro}
                            onChange={(e) => setIdIncludeYear(e.target.checked)}
                          />
                          Include year
                        </label>
                      </div>
                      <div className="rounded bg-surface-muted px-2.5 py-2 font-mono text-xs text-ink">
                        {idPreview || "Off - requests use REQ-YYYY-NNNNN"}
                      </div>
                      <p className="text-[11px] leading-snug text-ink-faint">
                        The prefix must be unique and is checked against existing IDs. Issued IDs never change.
                      </p>
                    </div>
                  </div>

                  {/* ---- Responsible owner ---- */}
                  <div className="rounded border border-surface-border p-3">
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-soft">
                      Responsible Owner
                    </div>
                    <div className="space-y-2">
                      <select
                        className="input"
                        value={ownerType}
                        disabled={ro}
                        onChange={(e) => setOwnerType(e.target.value as "none" | "dep" | "group")}
                      >
                        <option value="none">No owner</option>
                        <option value="dep">Department</option>
                        <option value="group">Group</option>
                      </select>
                      {ownerType === "dep" && (
                        <select
                          className="input"
                          value={ownerDepId}
                          disabled={ro}
                          onChange={(e) => setOwnerDepId(e.target.value)}
                        >
                          <option value="">Select department...</option>
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {ownerType === "group" && (
                        <select
                          className="input"
                          value={ownerGroupId}
                          disabled={ro}
                          onChange={(e) => setOwnerGroupId(e.target.value)}
                        >
                          <option value="">Select group...</option>
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <p className="text-[11px] leading-snug text-ink-faint">
                        The owner is shown on the catalog card and notified on new submissions.
                      </p>
                    </div>
                  </div>

                  {/* ---- Visibility ---- */}
                  <div className="rounded border border-surface-border p-3">
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-soft">
                      Visibility
                    </div>
                    <div className="mb-2 flex gap-2">
                      {(["public", "restricted"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          disabled={ro}
                          onClick={() => setVisMode(m)}
                          className={`flex-1 rounded border px-2 py-1.5 text-xs font-semibold capitalize ${
                            visMode === m
                              ? "border-primary bg-blue-50 text-primary"
                              : "border-surface-border text-ink-soft hover:border-primary"
                          } disabled:opacity-50`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                    {visMode === "public" ? (
                      <p className="text-[11px] leading-snug text-ink-faint">
                        Everyone who can create requests can see and use this form.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {canManage && (
                          <div className="flex gap-1.5">
                            <select
                              className="input !w-auto shrink-0"
                              value={visKind}
                              onChange={(e) => {
                                setVisKind(e.target.value as "dep" | "group" | "user");
                                setVisPick("");
                              }}
                            >
                              <option value="dep">Department</option>
                              <option value="group">Group</option>
                              <option value="user">User</option>
                            </select>
                            <select
                              className="input min-w-0 flex-1"
                              value={visPick}
                              onChange={(e) => setVisPick(e.target.value)}
                            >
                              <option value="">Select...</option>
                              {visOptions.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={addVisChip}
                              disabled={!visPick}
                              className="btn-secondary shrink-0 !px-3 disabled:opacity-50"
                            >
                              Add
                            </button>
                          </div>
                        )}
                        {visChips.length === 0 && (
                          <p className="text-[11px] italic text-ink-faint">
                            No entries yet — add at least one, or switch back to Public.
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          {visChips.map((c) => (
                            <span
                              key={c.key}
                              className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-muted py-1 pl-2.5 pr-1 text-xs font-medium text-ink"
                            >
                              <Icon
                                name={c.kind === "dep" ? "apartment" : c.kind === "group" ? "group" : "person"}
                                className="text-[14px] text-ink-faint"
                              />
                              <span className="truncate">{c.label}</span>
                              {canManage && (
                                <button
                                  type="button"
                                  aria-label="Remove"
                                  onClick={() =>
                                    setVisChips((prev) => prev.filter((x) => x.key !== c.key))
                                  }
                                  className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-surface-border"
                                >
                                  <Icon name="close" className="text-[14px]" />
                                </button>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded bg-surface-muted p-3">
                    <div className="mb-1.5 text-xs font-semibold text-ink">How it works</div>
                    <ul className="list-disc space-y-1 pl-4 text-[11px] leading-snug text-ink-soft">
                      <li>Only Active templates appear in the New Request catalog.</li>
                      <li>Set an ID prefix (e.g. PR) for custom numbering like PR1, PR2.</li>
                      <li>Field keys must be unique — they identify answers.</li>
                      <li>Required fields block submission until filled.</li>
                      <li>Sections are layout-only and never store answers.</li>
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
