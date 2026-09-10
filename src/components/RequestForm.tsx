"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { parseRequestFormConfig } from "@/lib/form-builtins";
import AppShell from "@/components/AppShell";
import { EmptyState, Icon } from "@/components/ui";
import {
  currencyByCode,
  evalShowWhen,
  formatMoney,
  isValueEmpty,
  parseAcceptList,
  parseFieldConfig,
  parseMultiValue,
} from "@/lib/field-config";

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
  RequestFormConfig?: string | null;
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
  id: string | null; // RequestItemID when editing, null for new rows
  catalogId: string | null;
  oracle: string | null;
  code: string;
  name: string;
  uom: string;
  qty: number;
  org: string;
  price: string;
}
interface LookupUser {
  UserID: string;
  Name: string;
  Email: string;
}
interface LookupDep {
  DEPID: string;
  Name: string;
}
interface ExistingAtt {
  id: string;
  name: string;
  size: number;
  fieldId: string | null;
}
interface EditItemPayload {
  RequestItemID: string;
  RequestedItemName: string;
  RequestedUom: string | null;
  RequestedQuantity: number | string;
  ItemCatalogCacheID: string | null;
  OracleItemID: string | null;
  ItemCode: string | null;
  Uom: string | null;
  OrganizationCode: string | null;
  EstimatedPrice: number | string | null;
}
interface EditAttPayload {
  RequestAttachmentID: string;
  FileName: string;
  FileSize: number | string;
  FormFieldID: string | null;
}
interface EditValuePayload {
  FormFieldID: string | null;
  Value: string;
  FormField: { FieldType: string } | null;
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

function inputType(t: string): string {
  if (t === "number" || t === "currency") return "number";
  if (t === "date") return "date";
  if (t === "time") return "time";
  if (t === "datetime") return "datetime-local";
  if (t === "email" || t === "tel" || t === "url") return t;
  return "text";
}

export default function RequestForm({
  templateId,
  editRequestId,
}: {
  templateId: string | null;
  editRequestId: string | null;
}) {
  const { token, user } = useAuth();
  const router = useRouter();
  const isEdit = editRequestId !== null;

  const [template, setTemplate] = useState<Template | null | undefined>(undefined);
  const [forbidden, setForbidden] = useState(false);
  const [editError, setEditError] = useState("");
  const [loadedReq, setLoadedReq] = useState<{ tracking: string; requesterId: string } | null>(null);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [neededBy, setNeededBy] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldFiles, setFieldFiles] = useState<Record<string, File[]>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [existingAtts, setExistingAtts] = useState<ExistingAtt[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const [invalidTitle, setInvalidTitle] = useState(false);
  const [invalidNeeded, setInvalidNeeded] = useState(false);
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const [invalidRows, setInvalidRows] = useState<number[]>([]);
  const [userOpts, setUserOpts] = useState<{ id: string; name: string }[]>([]);
  const [depOpts, setDepOpts] = useState<{ id: string; name: string }[]>([]);

  const [cq, setCq] = useState("");
  const [cHits, setCHits] = useState<CatItem[]>([]);
  const [cOpen, setCOpen] = useState(false);
  const [cSearching, setCSearching] = useState(false);
  const keyRef = useRef(1);
  const cTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canCreate = user?.permissions?.includes("REQUEST_CREATE") ?? false;
  const canCatalog = user?.permissions?.includes("CATALOG_VIEW") ?? false;
  const isAdmin = user?.role.code === "SUPER_ADMIN";
  const editDenied =
    isEdit && !!loadedReq && !!user && loadedReq.requesterId !== user.id && !isAdmin;

  useEffect(() => {
    if (!token) return;
    if (!isEdit && templateId) {
      fetch(`/api/form-templates/${templateId}?context=fill`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(async (r) => {
          if (r.status === 403) {
            setForbidden(true);
            setTemplate(null);
            return;
          }
          setTemplate(r.ok ? await r.json() : null);
        })
        .catch(() => setTemplate(null));
    } else if (isEdit && editRequestId) {
      (async () => {
        try {
          const r = await fetch(`/api/requests/${editRequestId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (r.status === 403 || r.status === 404) {
            setEditError(
              r.status === 403
                ? "You don't have permission to edit this request."
                : "Request not found."
            );
            return;
          }
          if (!r.ok) {
            setEditError("Failed to load request.");
            return;
          }
          const req = await r.json();
          if (req.Status !== "DRAFT") {
            setEditError("Only draft requests can be edited.");
            return;
          }
          setLoadedReq({ tracking: req.TrackingNumber, requesterId: req.RequesterID });
          setTitle(req.Title ?? "");
          setPriority(req.Priority ?? "MEDIUM");
          setNeededBy(req.NeededByDate ? String(req.NeededByDate).slice(0, 10) : "");
          const vals: Record<string, string> = {};
          for (const fv of (req.FieldValues || []) as EditValuePayload[]) {
            // file answers stay untouched — files are managed through attachments
            if (fv.FormFieldID && fv.FormField?.FieldType !== "file") {
              vals[fv.FormFieldID] = fv.Value ?? "";
            }
          }
          setValues(vals);
          const items = (req.Items || []) as EditItemPayload[];
          setRows(
            items.map((it, i) => ({
              key: i + 1,
              id: it.RequestItemID,
              catalogId: it.ItemCatalogCacheID ?? null,
              oracle: it.OracleItemID ?? null,
              code: it.ItemCode ?? "",
              name: it.RequestedItemName ?? "",
              uom: it.RequestedUom ?? it.Uom ?? "Piece",
              qty: Number(it.RequestedQuantity ?? 0),
              org: it.OrganizationCode ?? "",
              price: it.EstimatedPrice != null ? String(it.EstimatedPrice) : "",
            }))
          );
          keyRef.current = items.length + 1;
          setExistingAtts(
            ((req.Attachments || []) as EditAttPayload[]).map((a) => ({
              id: a.RequestAttachmentID,
              name: a.FileName,
              size: Number(a.FileSize ?? 0),
              fieldId: a.FormFieldID ?? null,
            }))
          );
          const t = await fetch(`/api/form-templates/${req.FormTemplateID}?context=fill`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          setTemplate(t.ok ? await t.json() : null);
        } catch {
          setEditError("Failed to load request.");
        }
      })();
    }
  }, [token, templateId, editRequestId, isEdit]);

  const needsUser = useMemo(
    () => (template?.Fields || []).some((f) => f.FieldType === "user"),
    [template]
  );
  const needsDep = useMemo(
    () => (template?.Fields || []).some((f) => f.FieldType === "department"),
    [template]
  );

  // Load picker options only when the form actually uses them
  useEffect(() => {
    if (!token || !template) return;
    if (needsUser) {
      fetch("/api/users/lookup", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : []))
        .then((d: LookupUser[]) =>
          setUserOpts((d || []).map((u) => ({ id: u.UserID, name: `${u.Name} (${u.Email})` })))
        )
        .catch(() => setUserOpts([]));
    }
    if (needsDep) {
      fetch("/api/departments", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : []))
        .then((d: LookupDep[]) =>
          setDepOpts((d || []).map((x) => ({ id: x.DEPID, name: x.Name })))
        )
        .catch(() => setDepOpts([]));
    }
  }, [token, template, needsUser, needsDep]);

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

  function typeOf(fieldId: string): string {
    return template?.Fields.find((f) => f.FormFieldID === fieldId)?.FieldType ?? "text";
  }

  function toggleMulti(fieldId: string, opt: string) {
    const cur = parseMultiValue(values[fieldId] || "");
    const next = cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt];
    setValues({ ...values, [fieldId]: JSON.stringify(next) });
  }

  function addCustomRow() {
    const key = keyRef.current++;
    setRows((p) => [...p, { key, id: null, catalogId: null, oracle: null, code: "", name: "", uom: "Piece", qty: 1, org: "", price: "" }]);
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
        id: null,
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

  async function deleteExistingAtt(id: string) {
    if (!editRequestId || busy) return;
    try {
      const r = await fetch(`/api/requests/${editRequestId}/attachments/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({} as { error?: string }));
        throw new Error(e.error || "Failed to delete file");
      }
      setExistingAtts((p) => p.filter((a) => a.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete file");
    }
  }

  // Built-in inputs config (title/priority/needed-by/attachments/items) + conditional field visibility
  const bc = parseRequestFormConfig(template?.RequestFormConfig ?? null);
  const valueByKey = (k: string): string => {
    const f = template?.Fields.find((x) => x.FieldKey === k);
    return f ? values[f.FormFieldID] || "" : "";
  };
  const isFieldVisible = (f: TField): boolean =>
    evalShowWhen(parseFieldConfig(f.Config).showWhen, valueByKey);

  function validate(submit: boolean): boolean {
    if (!submit) return true;
    const badFields =
      template?.Fields.filter((f) => {
        if (f.FieldType === "section" || !f.IsRequired) return false;
        if (!isFieldVisible(f)) return false;
        if (f.FieldType === "file") {
          const have =
            (fieldFiles[f.FormFieldID] || []).length +
            existingAtts.filter((a) => a.fieldId === f.FormFieldID).length;
          return have === 0;
        }
        return isValueEmpty(f.FieldType, values[f.FormFieldID] || "");
      }).map((f) => f.FormFieldID) || [];
    const badRows = rows
      .filter((r) => !r.name.trim() || !(r.qty > 0) || (r.price.trim() !== "" && isNaN(Number(r.price))))
      .map((r) => r.key);
    const badTitle = bc.title.show && bc.title.required && title.trim() === "";
    const badNeeded = bc.neededBy.show && bc.neededBy.required && !neededBy;
    setInvalidFields(badFields);
    setInvalidRows(badRows);
    setInvalidTitle(badTitle);
    setInvalidNeeded(badNeeded);
    const msgs: string[] = [];
    if (badTitle) msgs.push("Request title is required");
    if (badNeeded) msgs.push("Needed-by date is required");
    if (badFields.length > 0 && template) {
      const labels = template.Fields.filter((f) => badFields.includes(f.FormFieldID)).map((f) => f.Label);
      msgs.push(`Missing required fields: ${labels.join(", ")}`);
    }
    if (bc.items.show) {
      if (rows.length === 0) msgs.push("Add at least one item");
      else if (badRows.length > 0) msgs.push("Some items are missing a name, quantity or valid price");
    }
    if (msgs.length > 0) {
      setError(msgs.join(" · "));
      return false;
    }
    return true;
  }

  async function uploadAll(requestId: string) {
    if (files.length > 0) {
      const fails: string[] = [];
      await Promise.all(
        files.map(async (f) => {
          const fd = new FormData();
          fd.append("file", f);
          try {
            const up = await fetch(`/api/requests/${requestId}/attachments`, {
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

    const fieldEntries = Object.entries(fieldFiles).filter(([, fs]) => fs.length > 0);
    if (fieldEntries.length > 0) {
      const fieldFails: string[] = [];
      await Promise.all(
        fieldEntries.flatMap(([fieldId, fs]) =>
          fs.map(async (f) => {
            const fd = new FormData();
            fd.append("file", f);
            fd.append("formFieldId", fieldId);
            try {
              const up = await fetch(`/api/requests/${requestId}/attachments`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: fd,
              });
              if (!up.ok) {
                const e = await up.json().catch(() => ({} as { error?: string }));
                fieldFails.push(`${f.name}${e.error ? ` (${e.error})` : ""}`);
              }
            } catch {
              fieldFails.push(f.name);
            }
          })
        )
      );
      if (fieldFails.length > 0) throw new Error(`Saved as draft, but these field files failed: ${fieldFails.join("; ")}`);
    }
  }

  async function persist(submit: boolean) {
    if (!template || busy) return;
    setError("");
    setInvalidFields([]);
    setInvalidRows([]);
    setInvalidTitle(false);
    setInvalidNeeded(false);
    if (!validate(submit)) return;
    setBusy(submit ? "submit" : "draft");
    try {
      let requestId: string;
      if (isEdit && editRequestId) {
        const res = await fetch(`/api/requests/${editRequestId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            action: "UPDATE_DRAFT",
            title: title.trim() || null,
            priority,
            neededByDate: neededBy || null,
            fieldValues: Object.entries(values)
              .filter(([fieldId]) => {
                const f = template.Fields.find((x) => x.FormFieldID === fieldId);
                return !f || isFieldVisible(f);
              })
              .filter(([fieldId, v]) => typeOf(fieldId) !== "file" && !isValueEmpty(typeOf(fieldId), v))
              .map(([fieldId, value]) => ({ fieldId, value: value.trim() })),
            items: rows
              .filter((r) => r.name.trim() && r.qty > 0)
              .map((r) => ({
                id: r.id,
                name: r.name.trim(),
                quantity: Number(r.qty),
                uom: r.uom || undefined,
                catalogId: r.catalogId,
                oracleItemId: r.oracle,
                itemCode: r.code || undefined,
                itemName: r.catalogId ? r.name.trim() : undefined,
                itemUom: r.uom || undefined,
                orgCode: r.org || undefined,
                estimatedPrice: r.price.trim() === "" ? undefined : Number(r.price),
              })),
          }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({} as { error?: string }));
          throw new Error(e.error || "Failed to save changes");
        }
        requestId = editRequestId;
      } else {
        const res = await fetch("/api/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            formTemplateId: template.FormTemplateID,
            title: title.trim() || undefined,
            priority,
            neededByDate: neededBy || undefined,
            fieldValues: Object.entries(values)
              .filter(([fieldId]) => {
                const f = template.Fields.find((x) => x.FormFieldID === fieldId);
                return !f || isFieldVisible(f);
              })
              .filter(([fieldId, v]) => typeOf(fieldId) !== "file" && !isValueEmpty(typeOf(fieldId), v))
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
        requestId = created.RequestID;
      }

      await uploadAll(requestId);

      if (submit) {
        const s = await fetch(`/api/requests/${requestId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "SUBMIT" }),
        });
        if (!s.ok) {
          const e = await s.json().catch(() => ({} as { error?: string }));
          throw new Error(e.error || "Request saved as draft, but submit failed");
        }
      }
      router.push(`/requests/${requestId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  if (!isEdit && !canCreate) {
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
        {editDenied ? (
          <div className="card">
            <EmptyState
              icon="block"
              title="No permission"
              hint="Only the requester can edit this draft."
              action={
                <Link href={`/requests/${editRequestId}`} className="btn-secondary">
                  Back to request
                </Link>
              }
            />
          </div>
        ) : template === undefined && !editError ? (
          <div className="py-10 text-center text-sm text-ink-soft">Loading form...</div>
        ) : editError ? (
          <div className="card">
            <EmptyState
              icon="description"
              title="Cannot edit"
              hint={editError}
              action={
                <Link href={editRequestId ? `/requests/${editRequestId}` : "/requests"} className="btn-secondary">
                  Back to request
                </Link>
              }
            />
          </div>
        ) : forbidden ? (
          <div className="card">
            <EmptyState
              icon="block"
              title="No access to this form"
              hint="This form is restricted to specific departments, groups or users. Contact your administrator if you need access."
              action={
                <Link href="/requests/new" className="btn-secondary">
                  Back to catalog
                </Link>
              }
            />
          </div>
        ) : template == null || (!isEdit && template.Status !== "ACTIVE") ? (
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
              {isEdit ? (
                <div>
                  <h1 className="text-3xl font-bold text-ink">Edit Request</h1>
                  <p className="mt-1 text-sm text-ink-soft">
                    {loadedReq?.tracking}
                    {template ? ` · ${template.Name}` : ""}
                  </p>
                </div>
              ) : (
                <div>
                  <h1 className="text-3xl font-bold text-ink">{template.Name}</h1>
                  <p className="mt-1 text-sm text-ink-soft">
                    {template.Description || template.Category?.Name || "Fill in the details below"}
                  </p>
                </div>
              )}
              <Link
                href={isEdit ? `/requests/${editRequestId}` : "/requests/new"}
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
                  {bc.title.show && (
                    <div className="md:col-span-2">
                      <label className="label" htmlFor="req-title">
                        Request Title{" "}
                        {bc.title.required && <span className="text-danger">*</span>}
                      </label>
                      <input
                        id="req-title"
                        className={`input ${invalidTitle ? "!border-danger" : ""}`}
                        placeholder="e.g. Q4 Buffer Solution Batch A"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                      />
                    </div>
                  )}
                  {bc.priority.show && (
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
                  )}
                  {bc.neededBy.show && (
                    <div>
                      <label className="label" htmlFor="req-needed">
                        Needed By Date{" "}
                        {bc.neededBy.required && <span className="text-danger">*</span>}
                      </label>
                      <input
                        id="req-needed"
                        type="date"
                        className={`input ${invalidNeeded ? "!border-danger" : ""}`}
                        value={neededBy}
                        onChange={(e) => setNeededBy(e.target.value)}
                      />
                    </div>
                  )}
                  {[...template.Fields].sort((a, b) => a.SortOrder - b.SortOrder).map((f) => {
                    if (!isFieldVisible(f)) return null;
                    const invalid = invalidFields.includes(f.FormFieldID);
                    const cls = `input ${invalid ? "!border-danger" : ""}`;
                    const cfg = parseFieldConfig(f.Config);
                    const val = values[f.FormFieldID] || "";
                    const set = (v: string) => setValues({ ...values, [f.FormFieldID]: v });
                    const fileMax = cfg.maxFiles.trim() === "" ? 5 : Math.max(1, parseInt(cfg.maxFiles, 10) || 5);
                    const fileMB = cfg.maxSizeMB.trim() === "" ? 10 : Math.max(1, parseFloat(cfg.maxSizeMB) || 10);
                    const fileAccept = parseAcceptList(cfg.accept);
                    const filePicked = fieldFiles[f.FormFieldID] || [];
                    const existingFieldFiles = existingAtts.filter((a) => a.fieldId === f.FormFieldID);
                    const curDef = currencyByCode(cfg.currency) || null;

                    if (f.FieldType === "section") {
                      return (
                        <div key={f.FormFieldID} className="md:col-span-2">
                          <div className="border-l-2 border-primary pl-3">
                            <div className="text-base font-bold text-ink">{f.Label}</div>
                            {cfg.help && <p className="mt-0.5 text-xs text-ink-soft">{cfg.help}</p>}
                          </div>
                        </div>
                      );
                    }

                    const wide = f.FieldType === "textarea" || f.FieldType === "multiselect" || f.FieldType === "file";
                    const showLabel = f.FieldType !== "checkbox";
                    const numAttrs =
                      f.FieldType === "number" || f.FieldType === "currency"
                        ? {
                            min: cfg.min.trim() || undefined,
                            max: cfg.max.trim() || undefined,
                            step: f.FieldType === "currency" ? "0.01" : "any",
                          }
                        : {};
                    const lenAttrs =
                      f.FieldType === "text" || f.FieldType === "textarea"
                        ? {
                            minLength: cfg.minLength.trim() ? Number(cfg.minLength) : undefined,
                            maxLength: cfg.maxLength.trim() ? Number(cfg.maxLength) : undefined,
                          }
                        : {};
                    return (
                      <div key={f.FormFieldID} className={wide ? "md:col-span-2" : ""}>
                        {showLabel && (
                          <label className="label" htmlFor={f.FormFieldID}>
                            {f.Label} {f.IsRequired && <span className="text-danger">*</span>}
                          </label>
                        )}
                        {f.FieldType === "file" ? (
                          <div>
                            {existingFieldFiles.length > 0 && (
                              <div className="mb-2 divide-y divide-surface-border rounded border border-surface-border">
                                {existingFieldFiles.map((fl) => (
                                  <div key={fl.id} className="flex items-center gap-3 px-3 py-2">
                                    <Icon name="description" className="text-[18px] text-ink-faint" />
                                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{fl.name}</span>
                                    <span className="text-xs text-ink-faint">{fmtSize(fl.size)}</span>
                                    <button
                                      type="button"
                                      className="icon-btn !h-7 !w-7 text-danger"
                                      aria-label="Delete file"
                                      disabled={busy !== null}
                                      onClick={() => deleteExistingAtt(fl.id)}
                                    >
                                      <Icon name="delete" className="text-[16px]" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <label
                              className={`flex cursor-pointer items-center justify-center gap-2 rounded border border-dashed px-4 py-4 text-sm font-medium transition-colors ${
                                invalid
                                  ? "border-danger bg-red-50 text-red-700"
                                  : "border-surface-border bg-surface text-ink-soft hover:border-primary hover:text-primary-dark"
                              }`}
                            >
                              <Icon name="attach_file" className="text-[20px]" />
                              {existingFieldFiles.length + filePicked.length === 0
                                ? `Choose file${fileMax > 1 ? "s" : ""}... (up to ${fileMax})`
                                : `${existingFieldFiles.length + filePicked.length} of ${fileMax} selected — add more...`}
                              <input
                                type="file"
                                className="hidden"
                                multiple={fileMax > 1}
                                accept={fileAccept.map((a) => `.${a}`).join(",") || undefined}
                                onChange={(e) => {
                                  const picked = Array.from(e.target.files || []);
                                  if (picked.length === 0) return;
                                  setFieldFiles((prev) => {
                                    const cur = prev[f.FormFieldID] || [];
                                    const room = Math.max(0, fileMax - existingFieldFiles.length);
                                    return { ...prev, [f.FormFieldID]: [...cur, ...picked].slice(0, room) };
                                  });
                                  e.target.value = "";
                                }}
                              />
                            </label>
                            {filePicked.length > 0 && (
                              <div className="mt-2 divide-y divide-surface-border rounded border border-surface-border">
                                {filePicked.map((fl, i) => (
                                  <div key={`${fl.name}-${i}`} className="flex items-center gap-3 px-3 py-2">
                                    <Icon name="description" className="text-[18px] text-ink-faint" />
                                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{fl.name}</span>
                                    <span className="text-xs text-ink-faint">{fmtSize(fl.size)}</span>
                                    <button
                                      type="button"
                                      className="icon-btn !h-7 !w-7 text-danger"
                                      aria-label="Remove file"
                                      onClick={() =>
                                        setFieldFiles((prev) => ({
                                          ...prev,
                                          [f.FormFieldID]: (prev[f.FormFieldID] || []).filter((_, j) => j !== i),
                                        }))
                                      }
                                    >
                                      <Icon name="close" className="text-[16px]" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <p className="mt-1 text-xs text-ink-faint">
                              {fileAccept.length > 0 ? `Allowed: ${fileAccept.map((a) => `.${a}`).join(", ")} · ` : ""}
                              Max {fileMB} MB per file
                            </p>
                          </div>
                        ) : f.FieldType === "checkbox" ? (
                          <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm text-ink">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={val === "true"}
                              onChange={(e) => set(e.target.checked ? "true" : "")}
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
                            value={val}
                            onChange={(e) => set(e.target.value)}
                            {...lenAttrs}
                          />
                        ) : f.FieldType === "select" ? (
                          <select
                            id={f.FormFieldID}
                            className={cls}
                            value={val}
                            onChange={(e) => set(e.target.value)}
                          >
                            <option value="">Select...</option>
                            {cfg.options.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        ) : f.FieldType === "radio" ? (
                          <div className="space-y-1.5 pt-1">
                            {cfg.options.map((o) => (
                              <label key={o} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                                <input
                                  type="radio"
                                  name={f.FormFieldID}
                                  className="h-4 w-4"
                                  checked={val === o}
                                  onChange={() => set(o)}
                                />
                                {o}
                              </label>
                            ))}
                            {cfg.options.length === 0 && (
                              <p className="text-xs italic text-ink-faint">No options defined</p>
                            )}
                          </div>
                        ) : f.FieldType === "multiselect" ? (
                          <div className="space-y-1.5 rounded border border-surface-border p-3 pt-2">
                            {cfg.options.map((o) => (
                              <label key={o} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={parseMultiValue(val).includes(o)}
                                  onChange={() => toggleMulti(f.FormFieldID, o)}
                                />
                                {o}
                              </label>
                            ))}
                            {cfg.options.length === 0 && (
                              <p className="text-xs italic text-ink-faint">No options defined</p>
                            )}
                          </div>
                        ) : f.FieldType === "user" ? (
                          <select
                            id={f.FormFieldID}
                            className={cls}
                            value={val}
                            onChange={(e) => set(e.target.value)}
                          >
                            <option value="">Select user...</option>
                            {userOpts.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                        ) : f.FieldType === "department" ? (
                          <select
                            id={f.FormFieldID}
                            className={cls}
                            value={val}
                            onChange={(e) => set(e.target.value)}
                          >
                            <option value="">Select department...</option>
                            {depOpts.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                        ) : f.FieldType === "currency" ? (
                          <div>
                            <div className="relative">
                              <input
                                id={f.FormFieldID}
                                type="number"
                                step="0.01"
                                placeholder={cfg.placeholder || undefined}
                                className={`${cls} ${curDef ? "!pr-14" : ""}`}
                                value={val}
                                onChange={(e) => set(e.target.value)}
                                {...numAttrs}
                              />
                              {curDef && (
                                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-soft">
                                  {curDef.symbol}
                                </span>
                              )}
                            </div>
                            {curDef && val.trim() !== "" && (
                              <p className="mt-1 text-xs font-medium text-primary-dark">
                                {formatMoney(val, curDef.code)}
                              </p>
                            )}
                          </div>
                        ) : (
                          <input
                            id={f.FormFieldID}
                            type={inputType(f.FieldType)}
                            placeholder={cfg.placeholder || undefined}
                            className={cls}
                            value={val}
                            onChange={(e) => set(e.target.value)}
                            {...numAttrs}
                            {...lenAttrs}
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
              {bc.items.show && (
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
              )}

              {/* Attachments */}
              {bc.attachments.show && (
              <div className="p-6 md:p-8">
                <h2 className="mb-1 border-l-2 border-primary pl-3 text-lg font-semibold text-ink">
                  Attachments
                </h2>
                <p className="mb-4 text-[13px] text-ink-soft">
                  Quotations, specifications or supporting documents (max 10 MB each).
                </p>
                {existingAtts.filter((a) => !a.fieldId).length > 0 && (
                  <div className="mb-3 divide-y divide-surface-border rounded border border-surface-border">
                    {existingAtts
                      .filter((a) => !a.fieldId)
                      .map((a) => (
                        <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                          <Icon name="description" className="text-[20px] text-ink-faint" />
                          <span className="min-w-0 flex-1 truncate text-sm text-ink">{a.name}</span>
                          <span className="text-xs text-ink-faint">{fmtSize(a.size)}</span>
                          <button
                            type="button"
                            className="icon-btn !h-7 !w-7 text-danger"
                            onClick={() => deleteExistingAtt(a.id)}
                            disabled={busy !== null}
                            aria-label="Delete file"
                          >
                            <Icon name="delete" className="text-[16px]" />
                          </button>
                        </div>
                      ))}
                  </div>
                )}
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
              )}
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                className="btn-secondary"
                disabled={busy !== null}
                onClick={() => persist(false)}
              >
                {busy === "draft" ? "Saving..." : isEdit ? "Save Changes" : "Save Draft"}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy !== null}
                onClick={() => persist(true)}
              >
                <Icon name="send" className="text-[18px]" />
                {busy === "submit" ? "Submitting..." : isEdit ? "Save & Submit" : "Submit Request"}
              </button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
