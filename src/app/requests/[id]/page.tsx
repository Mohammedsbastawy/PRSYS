"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import {
  Avatar,
  EmptyState,
  Icon,
  Modal,
  StatusBadge,
  WorkflowTimeline,
  fmtSize,
  timeAgo,
  type TimelineNode,
} from "@/components/ui";

/* ================= types ================= */
interface Step {
  WFStepID: string;
  StepName: string;
  StepOrder: number;
  ApproverType: string;
}
interface Approval {
  RequestApprovalID: string;
  WFStepID: string;
  Decision: string;
  Comment: string | null;
  DecidedAt: string | null;
  CreatedAt: string;
  Approver: { UserID: string; Name: string };
  WFStep: { StepName: string };
}
interface CommentT {
  RequestCommentID: string;
  CommentText: string;
  CommentType: string;
  IsInternal: boolean;
  CreatedAt: string;
  Author: { UserID: string; Name: string; Role: { Name: string } };
}
interface Item {
  RequestItemID: string;
  RequestedItemName: string;
  RequestedItemDetails: string | null;
  RequestedUom: string | null;
  RequestedQuantity: number | string;
  ItemCatalogCacheID: string | null;
  ItemCode: string | null;
  ItemName: string | null;
  Uom: string | null;
  OrganizationCode: string | null;
  OnHandQuantity: number | string | null;
  ItemVerifiedByUserID: string | null;
  ItemVerifiedAt: string | null;
  IssuedFromStockQuantity: number | string;
  ToPurchaseQuantity: number | string | null;
  EstimatedPrice: number | string | null;
  StockDecisionNotes: string | null;
  Verifier: { UserID: string; Name: string } | null;
}
interface Att {
  RequestAttachmentID: string;
  FileName: string;
  MimeType: string;
  FileSize: string | number;
  CreatedAt: string;
  UploadedByUserID: string;
  Uploader: { UserID: string; Name: string };
}
function FileAnswerLinks({
  requestId,
  value,
  attachments,
  token,
  onError,
}: {
  requestId: string;
  value: string;
  attachments: Att[];
  token: string | null;
  onError: (msg: string) => void;
}) {
  let ids: string[] = [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) ids = parsed.map((x) => String(x));
  } catch {
    ids = [];
  }
  const files = ids
    .map((id) => attachments.find((a) => a.RequestAttachmentID === id))
    .filter((a): a is Att => !!a);
  if (files.length === 0) return <span className="text-ink-faint">—</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {files.map((a) => (
        <button
          key={a.RequestAttachmentID}
          type="button"
          title={`Download ${a.FileName}`}
          className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-muted py-1 pl-2.5 pr-3 text-xs font-medium text-primary-dark hover:bg-blue-100"
          onClick={() => {
            fetch(`/api/requests/${requestId}/attachments/${a.RequestAttachmentID}`, {
              headers: { Authorization: `Bearer ${token}` },
            })
              .then(async (r) => {
                if (!r.ok) throw new Error("Download failed");
                const blob = await r.blob();
                const url = URL.createObjectURL(blob);
                const el = document.createElement("a");
                el.href = url;
                el.download = a.FileName;
                el.click();
                URL.revokeObjectURL(url);
              })
              .catch(() => onError("Download failed"));
          }}
        >
          <Icon name="attach_file" className="text-[14px]" />
          <span className="truncate">{a.FileName}</span>
        </button>
      ))}
    </span>
  );
}

interface Audit {
  AuditLogID: string;
  FromStatus: string | null;
  ToStatus: string | null;
  Action: string | null;
  Note: string | null;
  CreatedAt: string;
  ChangedBy: { Name: string } | null;
}
interface ReqDetail {
  RequestID: string;
  TrackingNumber: string;
  Title: string | null;
  Status: string;
  Priority: string;
  NeededByDate: string | null;
  SubmittedAt: string | null;
  CreatedAt: string;
  CompletedAt: string | null;
  OraclePoNumber: string | null;
  PoCreatedAt: string | null;
  PoNotes: string | null;
  CurrentWFStepID: string | null;
  CanDecide: boolean;
  DecideReason: string | null;
  AwaitingTarget: string | null;
  Requester: { UserID: string; Name: string; Email: string };
  Assignee: { UserID: string; Name: string } | null;
  PoCreator: { Name: string } | null;
  RequesterDepartment: string | null;
  FormTemplate: {
    Name: string;
    Description: string | null;
    Category: { Name: string } | null;
    Workflow: { Name: string; Steps: Step[] } | null;
  };
  CurrentStep: (Step & {
    TargetUser: { Name: string } | null;
    TargetGroup: { Name: string } | null;
    TargetRole: { Name: string } | null;
  }) | null;
  FieldValues: { Value: string; DisplayValue?: string | null; FormField: { Label: string; FieldType: string } | null }[];
  Items: Item[];
  Approvals: Approval[];
  Comments: CommentT[];
  Attachments: Att[];
  AuditLogs: Audit[];
}
interface CatHit {
  ItemCatalogCacheID: string;
  OracleItemID: string;
  ItemCode: string;
  ItemName: string;
  Uom: string;
  OrganizationCode: string;
  LastPurchasedPrice: number | string | null;
}
interface LookupUser {
  UserID: string;
  Name: string;
  Email: string;
  Role: { Name: string };
}

/* ================= helpers ================= */
function fmtNum(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return String(parseFloat(n.toFixed(4)));
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function qty(v: number | string, uom: string | null): string {
  const n = fmtNum(v);
  return uom ? `${n} ${uom}` : n;
}

/* ================= small components ================= */
function SummaryRow({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-sm text-ink">
        <Icon name={icon} className="text-[18px] text-ink-faint" />
        <span className="min-w-0 truncate">{children}</span>
      </div>
    </div>
  );
}

function DecisionModal({
  mode,
  stepName,
  busy,
  onClose,
  onConfirm,
}: {
  mode: "APPROVE" | "REJECT" | "REQUEST_CLARIFICATION";
  stepName: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (comment: string) => void;
}) {
  const [text, setText] = useState("");
  const titles = {
    APPROVE: `Approve — ${stepName}`,
    REJECT: `Reject — ${stepName}`,
    REQUEST_CLARIFICATION: "Request Clarification",
  };
  const required = mode !== "APPROVE";
  return (
    <Modal open onClose={onClose} title={titles[mode]}>
      <label className="label" htmlFor="decision-text">
        {mode === "REQUEST_CLARIFICATION" ? "What do you need from the requester?" : "Decision comment"}
        {required && <span className="text-danger"> *</span>}
      </label>
      <textarea
        id="decision-text"
        rows={4}
        autoFocus
        className="input"
        placeholder={
          mode === "APPROVE"
            ? "Optional note for the requester..."
            : mode === "REJECT"
              ? "Explain why this request is rejected..."
              : "e.g. Please attach the supplier quotation and confirm the delivery date..."
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className={mode === "REJECT" ? "btn-danger" : "btn-primary"}
          disabled={busy || (required && !text.trim())}
          onClick={() => onConfirm(text.trim())}
        >
          {busy
            ? "Working..."
            : mode === "APPROVE"
              ? "Approve"
              : mode === "REJECT"
                ? "Reject"
                : "Send to Requester"}
        </button>
      </div>
    </Modal>
  );
}

function PoModal({ busy, onClose, onConfirm }: { busy: boolean; onClose: () => void; onConfirm: (po: string, notes: string) => void }) {
  const [po, setPo] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <Modal open onClose={onClose} title="Register Oracle PO">
      <label className="label" htmlFor="po-num">
        Oracle PO Number <span className="text-danger">*</span>
      </label>
      <input
        id="po-num"
        autoFocus
        className="input"
        placeholder="e.g. PO-2026-00137"
        value={po}
        onChange={(e) => setPo(e.target.value)}
      />
      <label className="label mt-3" htmlFor="po-notes">
        Notes
      </label>
      <textarea id="po-notes" rows={3} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={busy || !po.trim()} onClick={() => onConfirm(po.trim(), notes.trim())}>
          {busy ? "Saving..." : "Register PO"}
        </button>
      </div>
    </Modal>
  );
}

function AssignModal({
  token,
  current,
  busy,
  onClose,
  onConfirm,
}: {
  token: string;
  current: { UserID: string; Name: string } | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (id: string) => void;
}) {
  const [users, setUsers] = useState<LookupUser[]>([]);
  const [sel, setSel] = useState(current?.UserID || "");
  useEffect(() => {
    fetch("/api/users/lookup", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [token]);
  return (
    <Modal open onClose={onClose} title="Assign Request">
      <label className="label" htmlFor="assignee">
        Assign to
      </label>
      <select id="assignee" className="input" value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="">Select a user...</option>
        {users.map((u) => (
          <option key={u.UserID} value={u.UserID}>
            {u.Name} — {u.Role.Name}
          </option>
        ))}
      </select>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={busy || !sel} onClick={() => onConfirm(sel)}>
          {busy ? "Assigning..." : "Assign"}
        </button>
      </div>
    </Modal>
  );
}

function VerifyModal({
  token,
  requestId,
  item,
  busy,
  onClose,
  onSaved,
}: {
  token: string;
  requestId: string;
  item: Item;
  busy: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [catId, setCatId] = useState(item.ItemCatalogCacheID || "");
  const [catLabel, setCatLabel] = useState(item.ItemCode ? `[${item.ItemCode}] ${item.ItemName || ""}` : "");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CatHit[]>([]);
  const [open, setOpen] = useState(false);
  const [onHand, setOnHand] = useState(item.OnHandQuantity !== null ? String(item.OnHandQuantity) : "");
  const [issued, setIssued] = useState(String(item.IssuedFromStockQuantity ?? 0));
  const [toBuy, setToBuy] = useState(item.ToPurchaseQuantity !== null ? String(item.ToPurchaseQuantity) : "");
  const [price, setPrice] = useState(item.EstimatedPrice !== null ? String(item.EstimatedPrice) : "");
  const [notes, setNotes] = useState(item.StockDecisionNotes || "");
  const [err, setErr] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/catalog?q=${encodeURIComponent(q.trim())}&limit=8`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setHits(r.ok ? await r.json() : []);
      } catch {
        setHits([]);
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, token]);

  async function save() {
    setErr("");
    const num = (v: string) => (v.trim() === "" ? null : Number(v));
    for (const [v, l] of [[onHand, "On-hand"], [issued, "Issued"], [toBuy, "To purchase"], [price, "Price"]] as const) {
      if (v.trim() !== "" && (isNaN(Number(v)) || Number(v) < 0)) {
        setErr(`${l} must be a positive number`);
        return;
      }
    }
    onSavedAction({
      itemCatalogCacheId: catId || null,
      onHandQuantity: num(onHand),
      issuedFromStockQuantity: num(issued) ?? 0,
      toPurchaseQuantity: num(toBuy),
      estimatedPrice: num(price),
      stockDecisionNotes: notes.trim() || null,
    });
  }
  async function onSavedAction(body: Record<string, unknown>) {
    try {
      const r = await fetch(`/api/requests/${requestId}/items/${item.RequestItemID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({} as { error?: string }));
        throw new Error(e.error || "Failed to save verification");
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    }
  }

  return (
    <Modal open onClose={onClose} title={`Verify — ${item.RequestedItemName}`} wide>
      {err && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}
      <div className="relative mb-4">
        <label className="label">Linked Oracle catalog item</label>
        {catId ? (
          <div className="flex items-center justify-between rounded border border-surface-border bg-surface px-3 py-2 text-sm">
            <span className="truncate font-medium text-ink">{catLabel}</span>
            <button
              className="text-xs font-semibold text-danger hover:underline"
              onClick={() => {
                setCatId("");
                setCatLabel("");
              }}
            >
              Unlink
            </button>
          </div>
        ) : (
          <>
            <input
              className="input"
              placeholder="Search catalog by code or name..."
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
            />
            {open && q.trim().length >= 2 && (
              <div className="dropdown left-0 right-0 max-h-56 overflow-y-auto">
                {hits.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-ink-soft">No matches</div>
                ) : (
                  hits.map((h) => (
                    <button
                      key={h.ItemCatalogCacheID}
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setCatId(h.ItemCatalogCacheID);
                        setCatLabel(`[${h.ItemCode}] ${h.ItemName}`);
                        setOpen(false);
                        setQ("");
                      }}
                    >
                      <span className="truncate text-sm text-ink">
                        <span className="font-semibold">[{h.ItemCode}]</span> {h.ItemName}
                      </span>
                      <span className="shrink-0 text-sm text-ink-soft">{h.Uom}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <label className="label">On-hand qty</label>
          <input type="number" min="0" step="any" className="input" value={onHand} onChange={(e) => setOnHand(e.target.value)} />
        </div>
        <div>
          <label className="label">Issue from stock</label>
          <input type="number" min="0" step="any" className="input" value={issued} onChange={(e) => setIssued(e.target.value)} />
        </div>
        <div>
          <label className="label">To purchase</label>
          <input type="number" min="0" step="any" className="input" value={toBuy} onChange={(e) => setToBuy(e.target.value)} />
        </div>
        <div>
          <label className="label">Est. price</label>
          <input type="number" min="0" step="any" className="input" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
      </div>
      <label className="label mt-3">Decision notes</label>
      <textarea rows={2} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={busy} onClick={save}>
          {busy ? "Saving..." : "Save Verification"}
        </button>
      </div>
    </Modal>
  );
}

function StockLookup({ token }: { token: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CatHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/catalog?q=${encodeURIComponent(q.trim())}&limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setHits(r.ok ? await r.json() : []);
    } catch {
      setHits([]);
    } finally {
      setBusy(false);
      setSearched(true);
    }
  }
  return (
    <div className="card">
      <div className="flex flex-col gap-1 px-5 pt-5 md:flex-row md:items-center md:justify-between">
        <h3 className="text-lg font-semibold text-ink">Check Warehouse Stock</h3>
        <p className="text-[13px] text-ink-soft">Search Oracle inventory to confirm requested items are in stock before approving.</p>
      </div>
      <div className="p-5">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
            <Icon name="search" className="text-[20px]" />
          </span>
          <input
            className="input !pl-10"
            placeholder="Search by item name or code..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
        </div>
        {searched && (
          <div className="mt-3 overflow-x-auto rounded border border-surface-border">
            <table className="tbl w-full min-w-[640px]">
              <thead>
                <tr>
                  <th>Item Code</th>
                  <th>Item Name</th>
                  <th>Warehouse/Org</th>
                  <th className="!text-right">Last Price</th>
                </tr>
              </thead>
              <tbody>
                {hits.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-ink-faint">
                      No catalog matches
                    </td>
                  </tr>
                )}
                {hits.map((h) => (
                  <tr key={h.ItemCatalogCacheID}>
                    <td className="font-semibold text-ink">[{h.ItemCode}]</td>
                    <td>{h.ItemName}</td>
                    <td className="text-ink-soft">{h.OrganizationCode}</td>
                    <td className="!text-right font-medium text-primary-dark">
                      {h.LastPurchasedPrice !== null ? fmtNum(h.LastPurchasedPrice) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {busy && <div className="mt-2 text-sm text-ink-soft">Searching...</div>}
      </div>
    </div>
  );
}

/* ================= page ================= */
export default function RequestDetailPage() {
  const { token, user } = useAuth();
  const params = useParams();
  const id = params.id as string;

  const [req, setReq] = useState<ReqDetail | null>(null);
  const [denied, setDenied] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [decision, setDecision] = useState<"APPROVE" | "REJECT" | "REQUEST_CLARIFICATION" | null>(null);
  const [poOpen, setPoOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [verifyItem, setVerifyItem] = useState<Item | null>(null);
  const [comment, setComment] = useState("");
  const [internal, setInternal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cancelArm, setCancelArm] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`/api/requests/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      setReq(await r.json());
      setDenied("");
    } else if (r.status === 404) setDenied("Request not found.");
    else if (r.status === 403) setDenied("You don't have permission to view this request.");
    else setDenied("Failed to load request.");
  }, [token, id]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setActionError("");
    try {
      const r = await fetch(`/api/requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({} as { error?: string }));
        throw new Error(e.error || "Action failed");
      }
      setDecision(null);
      setPoOpen(false);
      setAssignOpen(false);
      setCancelArm(false);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  async function postComment() {
    if (!comment.trim() || busy) return;
    setBusy("COMMENT");
    setActionError("");
    try {
      const r = await fetch(`/api/requests/${id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: comment.trim(), isInternal: internal }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({} as { error?: string }));
        throw new Error(e.error || "Failed to post comment");
      }
      setComment("");
      setInternal(false);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to post comment");
    } finally {
      setBusy(null);
    }
  }

  async function uploadFiles(list: FileList | null) {
    if (!list || list.length === 0 || !token) return;
    setUploading(true);
    setActionError("");
    const fails: string[] = [];
    await Promise.all(
      Array.from(list).map(async (f) => {
        const fd = new FormData();
        fd.append("file", f);
        try {
          const r = await fetch(`/api/requests/${id}/attachments`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
          });
          if (!r.ok) fails.push(f.name);
        } catch {
          fails.push(f.name);
        }
      })
    );
    setUploading(false);
    if (fails.length > 0) setActionError(`These files failed to upload: ${fails.join(", ")}`);
    await load();
  }

  async function deleteAttachment(attId: string) {
    if (!token) return;
    const r = await fetch(`/api/requests/${id}/attachments/${attId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({} as { error?: string }));
      setActionError(e.error || "Failed to delete file");
      return;
    }
    await load();
  }

  if (denied) {
    return (
      <AppShell>
        <div className="card">
          <EmptyState
            icon="lock"
            title="Can't open this request"
            hint={denied}
            action={
              <Link href="/requests" className="btn-secondary">
                Back to Requests
              </Link>
            }
          />
        </div>
      </AppShell>
    );
  }
  if (!req) {
    return (
      <AppShell>
        <div className="py-10 text-center text-sm text-ink-soft">Loading request...</div>
      </AppShell>
    );
  }

  const perms = user?.permissions || [];
  const p = (c: string) => perms.includes(c);
  const isOwner = req.Requester.UserID === user?.id;
  const canApprove =
    p("REQUEST_APPROVE") &&
    ["PENDING_APPROVAL", "CLARIFICATION_REQUESTED"].includes(req.Status) &&
    !!req.CurrentWFStepID &&
    req.CanDecide;
  const decideBlocked =
    p("REQUEST_APPROVE") &&
    ["PENDING_APPROVAL", "CLARIFICATION_REQUESTED"].includes(req.Status) &&
    !!req.CurrentWFStepID &&
    !req.CanDecide;
  const canVerify = p("REQUEST_VERIFY_ITEMS");
  const canCatalog = p("CATALOG_VIEW");
  const canSeeInternal = p("REQUEST_VIEW_ALL");
  const cancellable = ["DRAFT", "PENDING_APPROVAL", "CLARIFICATION_REQUESTED"].includes(req.Status);

  /* timeline nodes */
  const wfSteps = req.FormTemplate.Workflow?.Steps || [];
  const approvedByStep = new Map<string, Approval>();
  req.Approvals.filter((a) => a.Decision === "APPROVED").forEach((a) => approvedByStep.set(a.WFStepID, a));
  const rejectedApproval = req.Approvals.find((a) => a.Decision === "REJECTED");
  const doneStatuses = ["APPROVED", "PO_REGISTERED", "FULFILLED", "COMPLETED"];
  const isDone = doneStatuses.includes(req.Status);
  const finalLabel =
    req.Status === "COMPLETED" || req.Status === "FULFILLED"
      ? "Completed"
      : req.Status === "PO_REGISTERED"
        ? "PO Registered"
        : "Approved";
  const awaitingTarget =
    req.AwaitingTarget ||
    (req.CurrentStep
      ? req.CurrentStep.TargetUser?.Name ||
        req.CurrentStep.TargetGroup?.Name ||
        req.CurrentStep.TargetRole?.Name ||
        "Approver"
      : null);
  const nodes: TimelineNode[] = [{ name: "Submitted", state: "done", sub: fmtDate(req.SubmittedAt || req.CreatedAt) }];
  wfSteps.forEach((s) => {
    const ap = approvedByStep.get(s.WFStepID);
    if (ap) {
      nodes.push({ name: s.StepName, state: "done", sub: ap.Approver.Name });
    } else if (rejectedApproval?.WFStepID === s.WFStepID) {
      nodes.push({ name: s.StepName, state: "rejected", sub: `Rejected by ${rejectedApproval.Approver.Name}` });
    } else if (s.WFStepID === req.CurrentWFStepID) {
      nodes.push({ name: s.StepName, state: "current", sub: awaitingTarget ? `Awaiting: ${awaitingTarget}` : undefined });
    } else {
      nodes.push({ name: s.StepName, state: "todo" });
    }
  });
  nodes.push({ name: finalLabel, state: isDone ? "done" : req.Status === "REJECTED" ? "todo" : "todo" });

  /* unified discussion timeline */
  type FeedItem =
    | { kind: "comment"; at: string; c: CommentT }
    | { kind: "event"; at: string; a: Approval };
  const feed: FeedItem[] = [
    ...req.Comments.map((c): FeedItem => ({ kind: "comment", at: c.CreatedAt, c })),
    ...req.Approvals.map((a): FeedItem => ({ kind: "event", at: a.DecidedAt || a.CreatedAt, a })),
  ].sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime());

  const stepName = req.CurrentStep?.StepName || "Approval";

  return (
    <AppShell>
      <Link href="/requests" className="mb-3 flex items-center gap-1 text-sm text-ink-soft hover:text-primary-dark">
        <Icon name="arrow_back" className="text-[16px]" /> Back to My Requests
      </Link>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-ink">
          {req.Title || "Untitled request"}{" "}
          <span className="text-ink-soft">({req.TrackingNumber})</span>
        </h1>
        <StatusBadge status={req.Status} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {isOwner && req.Status === "DRAFT" && (
            <button className="btn-primary" disabled={busy !== null} onClick={() => act("SUBMIT")}>
              <Icon name="send" className="text-[18px]" /> {busy === "SUBMIT" ? "Submitting..." : "Submit Request"}
            </button>
          )}
          {decideBlocked && req.DecideReason && (
            <span className="rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
              {req.DecideReason}
            </span>
          )}
          {canApprove && (
            <>
              <button
                className="btn-secondary"
                disabled={busy !== null}
                onClick={() => setDecision("REQUEST_CLARIFICATION")}
              >
                Request Clarification
              </button>
              <button
                className="inline-flex items-center justify-center gap-1.5 rounded border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy !== null}
                onClick={() => setDecision("REJECT")}
              >
                <Icon name="close" className="text-[18px]" /> Reject
              </button>
              <button className="btn-primary" disabled={busy !== null} onClick={() => setDecision("APPROVE")}>
                <Icon name="check" className="text-[18px]" /> Approve
              </button>
            </>
          )}
          {p("REQUEST_ASSIGN") && (
            <button className="btn-secondary" disabled={busy !== null} onClick={() => setAssignOpen(true)}>
              <Icon name="person_add" className="text-[18px]" /> Assign
            </button>
          )}
          {p("REQUEST_REGISTER_PO") && req.Status === "APPROVED" && (
            <button className="btn-secondary" disabled={busy !== null} onClick={() => setPoOpen(true)}>
              <Icon name="receipt_long" className="text-[18px]" /> Register PO
            </button>
          )}
          {p("REQUEST_FULFILL") && ["APPROVED", "PO_REGISTERED"].includes(req.Status) && (
            <button className="btn-secondary" disabled={busy !== null} onClick={() => act("FULFILL_STOCK")}>
              <Icon name="inventory_2" className="text-[18px]" />{" "}
              {busy === "FULFILL_STOCK" ? "Working..." : "Mark Fulfilled"}
            </button>
          )}
          {p("REQUEST_FULFILL") && req.Status === "FULFILLED" && (
            <button className="btn-secondary" disabled={busy !== null} onClick={() => act("COMPLETE")}>
              <Icon name="task_alt" className="text-[18px]" /> {busy === "COMPLETE" ? "Working..." : "Complete"}
            </button>
          )}
          {isOwner && cancellable && req.Status !== "CANCELLED" && !cancelArm && (
            <button className="btn-ghost text-danger" disabled={busy !== null} onClick={() => setCancelArm(true)}>
              Cancel request
            </button>
          )}
          {cancelArm && (
            <span className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-sm">
              <span className="font-medium text-red-800">Cancel this request?</span>
              <button
                className="font-semibold text-red-700 hover:underline disabled:opacity-50"
                disabled={busy !== null}
                onClick={() => act("CANCEL")}
              >
                Yes
              </button>
              <button className="text-ink-soft hover:underline" onClick={() => setCancelArm(false)}>
                No
              </button>
            </span>
          )}
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-ink-soft">
        <span className="flex items-center gap-1">
          <Icon name="category" className="text-[16px]" />
          {req.FormTemplate.Category?.Name || "General"} · {req.FormTemplate.Name}
        </span>
        <span className="flex items-center gap-1">
          <Icon name="flag" className="text-[16px]" /> Priority: {req.Priority}
        </span>
        <span className="flex items-center gap-1">
          <Icon name="event" className="text-[16px]" /> Needed by: {fmtDate(req.NeededByDate)}
        </span>
        <span className="flex items-center gap-1">
          <Icon name="schedule" className="text-[16px]" /> Submitted: {fmtDate(req.SubmittedAt || req.CreatedAt)}
        </span>
        {req.Assignee && (
          <span className="flex items-center gap-1">
            <Icon name="person" className="text-[16px]" /> Assigned to: {req.Assignee.Name}
          </span>
        )}
      </div>

      {actionError && (
        <div className="mb-4 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <Icon name="error" className="mt-0.5 text-[18px]" />
          <span>{actionError}</span>
        </div>
      )}

      {req.OraclePoNumber && (
        <div className="card mb-4 flex items-center gap-4 bg-purple-50/60 p-4">
          <Icon name="receipt_long" className="text-[28px] text-purple-700" />
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">Oracle PO</div>
            <div className="text-lg font-bold text-purple-900">{req.OraclePoNumber}</div>
            <div className="text-xs text-ink-soft">
              Registered{req.PoCreator ? ` by ${req.PoCreator.Name}` : ""}
              {req.PoCreatedAt ? ` · ${fmtDateTime(req.PoCreatedAt)}` : ""}
              {req.PoNotes ? ` · ${req.PoNotes}` : ""}
            </div>
          </div>
        </div>
      )}

      {/* Workflow Status */}
      <div className="card mb-4 p-5">
        <h3 className="mb-2 text-lg font-semibold text-ink">Workflow Status</h3>
        {req.Status === "DRAFT" ? (
          <span className="badge bg-gray-100 text-gray-600">Not submitted yet — submit to start {req.FormTemplate.Workflow?.Name || "the approval workflow"}</span>
        ) : req.Status === "CANCELLED" ? (
          <span className="badge bg-gray-100 text-gray-500">Cancelled — workflow stopped</span>
        ) : (
          <WorkflowTimeline nodes={nodes} />
        )}
        {req.Status === "CLARIFICATION_REQUESTED" && (
          <div className="mt-3 flex items-start gap-2 rounded border border-orange-200 bg-orange-50 px-3 py-2 text-[13px] text-orange-900">
            <Icon name="help" className="mt-0.5 text-[16px]" />
            <span>
              {isOwner
                ? "An approver needs more information — reply in the discussion below and the request returns to the queue automatically."
                : "Waiting for the requester to reply. The request returns to the queue automatically once they comment."}
            </span>
          </div>
        )}
      </div>

      {/* Summary + Items */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-5">
          <h3 className="mb-3 text-lg font-semibold text-ink">Request Summary</h3>
          <div className="space-y-3 border-t border-surface-border pt-3">
            <SummaryRow icon="person" label="Requestor">
              {req.Requester.Name}
            </SummaryRow>
            <SummaryRow icon="domain" label="Department">
              {req.RequesterDepartment || "—"}
            </SummaryRow>
            <SummaryRow icon="event" label="Needed By">
              {fmtDate(req.NeededByDate)}
            </SummaryRow>
            {req.FieldValues.map((fv, i) => (
              <SummaryRow key={i} icon="info" label={fv.FormField?.Label || "Field"}>
                {fv.FormField?.FieldType === "file" ? (
                  <FileAnswerLinks
                    requestId={req.RequestID}
                    value={fv.Value}
                    attachments={req.Attachments}
                    token={token}
                    onError={setActionError}
                  />
                ) : (
                  fv.DisplayValue ?? fv.Value
                )}
              </SummaryRow>
            ))}
          </div>
        </div>

        <div className="card overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between px-5 pt-5">
            <h3 className="text-lg font-semibold text-ink">Requested Items</h3>
            <span className="badge bg-gray-100 text-gray-600">
              {req.Items.length} Item{req.Items.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="tbl w-full min-w-[560px]">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Grade / Spec</th>
                  <th className="!text-right">Quantity</th>
                  {canVerify && <th>Stock / Verify</th>}
                </tr>
              </thead>
              <tbody>
                {req.Items.length === 0 && (
                  <tr>
                    <td colSpan={canVerify ? 4 : 3} className="py-6 text-center text-ink-faint">
                      No items
                    </td>
                  </tr>
                )}
                {req.Items.map((it) => (
                  <tr key={it.RequestItemID}>
                    <td>
                      <div className="font-medium text-ink">{it.RequestedItemName}</div>
                      {(it.ItemCode || it.OrganizationCode) && (
                        <div className="text-xs text-ink-faint">
                          {it.ItemCode ? `[${it.ItemCode}]` : ""}
                          {it.ItemCode && it.OrganizationCode ? " · " : ""}
                          {it.OrganizationCode || ""}
                        </div>
                      )}
                      {it.EstimatedPrice !== null && (
                        <div className="text-xs text-ink-faint">Est. {fmtNum(it.EstimatedPrice)}</div>
                      )}
                    </td>
                    <td className="text-ink-soft">{it.RequestedItemDetails || it.ItemName || "—"}</td>
                    <td className="!text-right">{qty(it.RequestedQuantity, it.RequestedUom || it.Uom)}</td>
                    {canVerify && (
                      <td>
                        {it.ItemVerifiedByUserID ? (
                          <div className="text-xs">
                            <span className="flex items-center gap-1 font-semibold text-green-700">
                              <Icon name="verified" className="text-[16px]" /> Verified
                            </span>
                            <span className="text-ink-faint">
                              {it.Verifier?.Name}
                              {it.ItemVerifiedAt ? ` · ${fmtDate(it.ItemVerifiedAt)}` : ""}
                            </span>
                            <span className="block text-ink-soft">
                              On-hand {fmtNum(it.OnHandQuantity)} · Issue {fmtNum(it.IssuedFromStockQuantity)} ·
                              Buy {fmtNum(it.ToPurchaseQuantity)}
                            </span>
                            <button
                              className="mt-1 font-semibold text-primary-dark hover:underline"
                              onClick={() => setVerifyItem(it)}
                            >
                              Edit
                            </button>
                          </div>
                        ) : (
                          <button className="btn-secondary !px-3 !py-1.5 !text-xs" onClick={() => setVerifyItem(it)}>
                            Verify
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Stock lookup (procurement) */}
      {canCatalog && (
        <div className="mb-4">
          <StockLookup token={token!} />
        </div>
      )}

      {/* Attachments */}
      <div className="card mb-4 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-ink">Attachments</h3>
          <label className="btn-secondary cursor-pointer !py-1.5">
            <Icon name="attach_file" className="text-[18px]" /> {uploading ? "Uploading..." : "Add files"}
            <input
              type="file"
              multiple
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                uploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {req.Attachments.length === 0 ? (
          <p className="text-sm text-ink-faint">No attachments yet.</p>
        ) : (
          <div className="divide-y divide-surface-border rounded border border-surface-border">
            {req.Attachments.map((a) => (
              <div key={a.RequestAttachmentID} className="flex items-center gap-3 px-4 py-2.5">
                <Icon name="description" className="text-[20px] text-ink-faint" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{a.FileName}</span>
                  <span className="block text-xs text-ink-faint">
                    {fmtSize(Number(a.FileSize))} · {a.Uploader.Name} · {fmtDateTime(a.CreatedAt)}
                  </span>
                </span>
                <a
                  className="icon-btn !h-8 !w-8"
                  title="Download"
                  href={`/api/requests/${req.RequestID}/attachments/${a.RequestAttachmentID}?token=${token}`}
                  onClick={(e) => {
                    // attachments API needs a Bearer header — fetch as blob instead
                    e.preventDefault();
                    fetch(`/api/requests/${req.RequestID}/attachments/${a.RequestAttachmentID}`, {
                      headers: { Authorization: `Bearer ${token}` },
                    })
                      .then(async (r) => {
                        if (!r.ok) throw new Error("Download failed");
                        const blob = await r.blob();
                        const url = URL.createObjectURL(blob);
                        const el = document.createElement("a");
                        el.href = url;
                        el.download = a.FileName;
                        el.click();
                        URL.revokeObjectURL(url);
                      })
                      .catch(() => setActionError("Download failed"));
                  }}
                >
                  <Icon name="download" className="text-[18px]" />
                </a>
                {(a.UploadedByUserID === user?.id || user?.role.code === "SUPER_ADMIN") && (
                  <button
                    className="icon-btn !h-8 !w-8 text-danger"
                    title="Delete"
                    onClick={() => deleteAttachment(a.RequestAttachmentID)}
                  >
                    <Icon name="delete" className="text-[18px]" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Comments & Discussion */}
      <div className="card mb-4 p-5">
        <h3 className="mb-4 border-b border-surface-border pb-3 text-lg font-semibold text-ink">
          Comments &amp; Discussion
        </h3>
        <div className="space-y-4">
          {feed.length === 0 && <p className="text-sm text-ink-faint">No comments yet.</p>}
          {feed.map((f) =>
            f.kind === "event" ? (
              <div key={f.a.RequestApprovalID} className="flex items-center gap-3">
                <div className="h-px flex-1 bg-surface-border" />
                <span
                  className={`badge gap-1 ${
                    f.a.Decision === "APPROVED" ? "bg-blue-50 text-primary-dark" : "bg-red-50 text-red-700"
                  }`}
                >
                  <Icon
                    name={f.a.Decision === "APPROVED" ? "check_circle" : "cancel"}
                    className="text-[14px]"
                  />
                  {f.a.Approver.Name} {f.a.Decision === "APPROVED" ? "approved" : "rejected"} this step
                  {f.a.Comment ? ` — ${f.a.Comment}` : ""}
                </span>
                <div className="h-px flex-1 bg-surface-border" />
              </div>
            ) : (
              <div key={f.c.RequestCommentID} className="flex gap-3">
                <Avatar name={f.c.Author.Name} />
                <div
                  className={`flex-1 rounded-lg border border-surface-border p-3 ${
                    f.c.IsInternal ? "border-l-2 !border-l-primary bg-surface" : "bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{f.c.Author.Name}</span>
                    {f.c.Author.UserID === req.Requester.UserID ? (
                      <span className="badge bg-blue-600 !px-2 !py-0 text-[11px] text-white">Requester</span>
                    ) : (
                      <span className="text-xs text-ink-soft">{f.c.Author.Role.Name}</span>
                    )}
                    {f.c.CommentType === "CLARIFICATION" && (
                      <span className="badge bg-orange-100 !px-2 !py-0 text-[11px] text-orange-800">
                        Clarification
                      </span>
                    )}
                    <span className="ml-auto text-xs text-ink-faint">{fmtDateTime(f.c.CreatedAt)}</span>
                  </div>
                  {f.c.IsInternal && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-ink-soft">
                      <Icon name="visibility_off" className="text-[14px]" /> Internal note — not visible to
                      requester
                    </div>
                  )}
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{f.c.CommentText}</p>
                </div>
              </div>
            )
          )}
        </div>

        <div className="mt-5 flex gap-3 border-t border-surface-border pt-4">
          <Avatar name={user?.name || "?"} />
          <div className="flex-1">
            <textarea
              rows={3}
              className="input"
              placeholder={
                isOwner && req.Status === "CLARIFICATION_REQUESTED"
                  ? "Reply to the approver — posting returns the request to the queue..."
                  : "Add a comment..."
              }
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="mt-2 flex items-center justify-between">
              <div>
                {canSeeInternal && (
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-soft">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-surface-border"
                      checked={internal}
                      onChange={(e) => setInternal(e.target.checked)}
                    />
                    Internal Note Only
                  </label>
                )}
                {isOwner && req.Status === "CLARIFICATION_REQUESTED" && (
                  <span className="text-[13px] text-ink-soft">Posting will resubmit your request automatically.</span>
                )}
              </div>
              <button className="btn-primary" disabled={busy !== null || !comment.trim()} onClick={postComment}>
                {busy === "COMMENT"
                  ? "Posting..."
                  : isOwner && req.Status === "CLARIFICATION_REQUESTED"
                    ? "Reply & Resubmit"
                    : "Post Comment"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Audit trail */}
      <details className="card">
        <summary className="cursor-pointer px-5 py-3 font-semibold text-ink">
          Audit Trail ({req.AuditLogs.length})
        </summary>
        <div className="divide-y divide-surface-border border-t border-surface-border">
          {req.AuditLogs.length === 0 && (
            <div className="px-5 py-4 text-sm text-ink-faint">No audit entries.</div>
          )}
          {req.AuditLogs.map((a) => (
            <div key={a.AuditLogID} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[13px]">
              <span className="font-semibold text-ink">{a.Action || "UPDATE"}</span>
              {a.FromStatus && a.ToStatus && (
                <span className="text-ink-soft">
                  {a.FromStatus.replace(/_/g, " ")} → {a.ToStatus.replace(/_/g, " ")}
                </span>
              )}
              {a.Note && <span className="text-ink-faint">· {a.Note}</span>}
              <span className="ml-auto text-ink-faint">
                {a.ChangedBy?.Name || "System"} · {timeAgo(a.CreatedAt)}
              </span>
            </div>
          ))}
        </div>
      </details>

      {decision && (
        <DecisionModal
          mode={decision}
          stepName={stepName}
          busy={busy !== null}
          onClose={() => setDecision(null)}
          onConfirm={(text) => act(decision, { comment: text || undefined })}
        />
      )}
      {poOpen && (
        <PoModal
          busy={busy !== null}
          onClose={() => setPoOpen(false)}
          onConfirm={(po, notes) => act("REGISTER_PO", { oraclePoNumber: po, poNotes: notes || undefined })}
        />
      )}
      {assignOpen && token && (
        <AssignModal
          token={token}
          current={req.Assignee}
          busy={busy !== null}
          onClose={() => setAssignOpen(false)}
          onConfirm={(assigneeId) => act("ASSIGN", { assigneeId })}
        />
      )}
      {verifyItem && token && (
        <VerifyModal
          token={token}
          requestId={req.RequestID}
          item={verifyItem}
          busy={busy !== null}
          onClose={() => setVerifyItem(null)}
          onSaved={() => {
            setVerifyItem(null);
            load();
          }}
        />
      )}
    </AppShell>
  );
}
