import { Fragment, ReactNode, useCallback, useEffect, useRef, useState } from "react";

/* ---------- Material Symbol icon ---------- */
export function Icon({
  name,
  className = "text-[20px]",
  filled = false,
}: {
  name: string;
  className?: string;
  filled?: boolean;
}) {
  return (
    <span className={`material-symbols-outlined ${filled ? "filled" : ""} ${className}`}>
      {name}
    </span>
  );
}

/* ---------- Template icon resolver (catalog cards) ---------- */
export function templateIcon(name: string): string {
  const n = name.toLowerCase();
  if (/chemical|reagent|science/.test(n)) return "science";
  if (/repair|maintenance/.test(n)) return "build";
  if (/logistic|ship/.test(n)) return "local_shipping";
  if (/software|license/.test(n)) return "vpn_key";
  if (/hardware|computer|laptop/.test(n)) return "computer";
  if (/network|vpn/.test(n)) return "router";
  if (/signature/.test(n)) return "draw";
  if (/tuition|school|train/.test(n)) return "school";
  if (/travel/.test(n)) return "flight_takeoff";
  if (/remote|home office/.test(n)) return "home_work";
  if (/conference/.test(n)) return "event_seat";
  if (/supply|supplies/.test(n)) return "package_2";
  if (/raw|material|inventory|stock|warehouse/.test(n)) return "inventory_2";
  if (/\bit\b|laptop|computer|software|equipment|device/.test(n)) return "devices";
  if (/vendor|payment|invoice|financ/.test(n)) return "payments";
  if (/expense|reimburse/.test(n)) return "receipt_long";
  if (/hr|leave|employee|staff/.test(n)) return "badge";
  if (/purchase|procure|general/.test(n)) return "shopping_cart";
  return "description";
}

/* ---------- Initials avatar ---------- */
const AVATAR_COLORS = [
  "bg-blue-600",
  "bg-teal-600",
  "bg-purple-600",
  "bg-orange-600",
  "bg-rose-600",
  "bg-cyan-700",
  "bg-indigo-600",
];

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 997;
  const color = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  const sz = size === "sm" ? "h-7 w-7 text-[11px]" : size === "lg" ? "h-11 w-11 text-base" : "h-8 w-8 text-xs";
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${color} ${sz}`}>
      {initials || "?"}
    </div>
  );
}

/* ---------- Status pill ---------- */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    DRAFT: "bg-gray-100 text-gray-700",
    ACTIVE: "bg-green-100 text-green-800",
    PENDING_APPROVAL: "bg-amber-100 text-amber-800",
    CLARIFICATION_REQUESTED: "bg-orange-100 text-orange-800",
    APPROVED: "bg-blue-100 text-blue-800",
    PO_REGISTERED: "bg-purple-100 text-purple-800",
    FULFILLED: "bg-teal-100 text-teal-800",
    REJECTED: "bg-red-100 text-red-800",
    CANCELLED: "bg-gray-100 text-gray-500",
    COMPLETED: "bg-green-100 text-green-800",
  };
  const cls = map[status] || "bg-gray-100 text-gray-700";
  return <span className={`badge ${cls}`}>{status.replace(/_/g, " ")}</span>;
}

/* ---------- Workflow progress stepper (mockup: dots + labeled nodes) ---------- */
export function WorkflowProgress({
  steps,
  current,
  status,
}: {
  steps: string[];
  current: number;
  status: string;
}) {
  if (status === "DRAFT")
    return <span className="badge bg-gray-100 font-medium text-gray-600">Draft</span>;
  if (status === "CANCELLED") return <StatusBadge status={status} />;

  const rejected = status === "REJECTED";
  const done = ["APPROVED", "PO_REGISTERED", "FULFILLED", "COMPLETED"].includes(status);
  const nodes = steps.length >= 2 ? steps : ["Submitted", "Approved"];
  const last = nodes.length - 1;
  const activeIdx = done ? last : Math.min(Math.max(current, 0), last);
  const finalLabel =
    status === "COMPLETED" || status === "FULFILLED"
      ? "Completed"
      : status === "PO_REGISTERED"
        ? "PO Registered"
        : "Approved";

  return (
    <div className="flex min-w-[240px] items-start">
      {nodes.map((s, i) => {
        const isDone = done || i < activeIdx;
        const isActive = i === activeIdx;
        const showLabel = i === 0 || isActive;
        return (
          <Fragment key={i}>
            {i > 0 && (
              <div className={`mx-0.5 mt-[5px] h-0.5 min-w-[16px] flex-1 ${i <= activeIdx ? "bg-primary" : "bg-gray-200"}`} />
            )}
            <div className="flex shrink-0 flex-col items-center gap-1">
              {rejected && isActive ? (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-600">
                  <Icon name="close" className="text-[11px] font-bold text-white" />
                </span>
              ) : done && i === last ? (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                  <Icon name="check" className="text-[11px] font-bold text-white" />
                </span>
              ) : isDone ? (
                <span className="h-2.5 w-2.5 rounded-full bg-primary" style={{ marginTop: 3, marginBottom: 3 }} />
              ) : isActive ? (
                <span className="h-3.5 w-3.5 rounded-full border-[2.5px] border-primary bg-white" />
              ) : (
                <span className="h-2.5 w-2.5 rounded-full bg-gray-200" style={{ marginTop: 3, marginBottom: 3 }} />
              )}
              {showLabel && (
                <span
                  title={s}
                  className={`max-w-[120px] truncate text-[11px] leading-tight ${
                    rejected && isActive
                      ? "font-semibold text-red-600"
                      : isActive
                        ? "font-semibold text-primary-dark"
                        : "text-ink-faint"
                  }`}
                >
                  {rejected && isActive ? "Rejected" : done && i === last ? finalLabel : s}
                </span>
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

/* ---------- Compact dots status (approval queues) ---------- */
export function DotsStatus({ total, current }: { total: number; current: number }) {
  const n = Math.max(total, 1);
  const c = Math.min(Math.max(current, 0), n - 1);
  return (
    <span className="inline-flex items-center gap-1.5">
      {Array.from({ length: n }).map((_, i) => (
        <span
          key={i}
          className={`rounded-full ${
            i < c ? "h-2 w-2 bg-primary" : i === c ? "h-2.5 w-2.5 bg-primary ring-2 ring-primary/25" : "h-2 w-2 bg-gray-200"
          }`}
        />
      ))}
    </span>
  );
}

/* ---------- Page header ---------- */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between">
      <div>
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---------- Stat card ---------- */
export function StatCard({
  label,
  value,
  color = "text-ink",
}: {
  label: string;
  value: number | string;
  color?: string;
}) {
  return (
    <div className="card p-4">
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="mt-1 text-sm text-ink-soft">{label}</div>
    </div>
  );
}

/* ---------- Pagination ---------- */
export function Pagination({
  page,
  totalPages,
  onChange,
  total,
  pageSize,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
  total?: number;
  pageSize?: number;
}) {
  if (totalPages <= 1 && total === undefined) return null;
  const from = total !== undefined && pageSize ? (page - 1) * pageSize + 1 : null;
  const to = total !== undefined && pageSize ? Math.min(page * pageSize, total) : null;
  return (
    <div className="flex items-center justify-between border-t border-surface-border bg-white px-4 py-3">
      <div className="text-sm text-ink-soft">
        {from !== null && to !== null && total !== undefined ? (
          <>
            Showing {from}-{to} of {total} entries
          </>
        ) : (
          <>Page {page} of {totalPages}</>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button className="icon-btn !h-8 !w-8" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page">
          <Icon name="chevron_left" />
        </button>
        <span className="min-w-[24px] text-center text-sm font-medium text-ink">{page}</span>
        <button
          className="icon-btn !h-8 !w-8"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          aria-label="Next page"
        >
          <Icon name="chevron_right" />
        </button>
      </div>
    </div>
  );
}

/* ---------- Modal ---------- */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`animate-dropdown relative max-h-[90vh] w-full overflow-y-auto rounded-lg bg-white shadow-xl ${wide ? "max-w-3xl" : "max-w-lg"}`}>
        <div className="flex items-center justify-between border-b border-surface-border px-5 py-3">
          <h3 className="font-semibold text-ink">{title}</h3>
          <button className="icon-btn !h-8 !w-8" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ---------- Empty state ---------- */
export function EmptyState({
  icon = "inbox",
  title,
  hint,
  action,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-ink-faint">
        <Icon name={icon} className="text-[26px]" />
      </span>
      <div className="font-semibold text-ink">{title}</div>
      {hint && <div className="max-w-sm text-sm text-ink-soft">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* ---------- Relative time ---------- */
export function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "Just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/* ---------- File size ---------- */
export function fmtSize(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ---------- Full workflow timeline (labeled nodes, detail pages) ---------- */
export interface TimelineNode {
  name: string;
  state: "done" | "current" | "todo" | "rejected" | "skipped";
  sub?: string;
  alert?: boolean;
}

export function WorkflowTimeline({ nodes }: { nodes: TimelineNode[] }) {
  return (
    <div className="slim-scroll flex items-start overflow-x-auto py-2">
      {nodes.map((n, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <div
              className={`mx-1 mt-[13px] h-0.5 min-w-[24px] flex-1 ${
                nodes[i - 1].state === "done" ? "bg-primary" : "bg-gray-200"
              }`}
            />
          )}
          <div className="flex w-28 shrink-0 flex-col items-center gap-1.5 text-center">
            {n.state === "done" ? (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary">
                <Icon name="check" className="text-[16px] font-bold text-white" />
              </span>
            ) : n.state === "current" ? (
              <span className="flex h-7 w-7 items-center justify-center rounded-full border-[2.5px] border-primary bg-white">
                <span className="h-2.5 w-2.5 rounded-full bg-primary" />
              </span>
            ) : n.state === "rejected" ? (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-600">
                <Icon name="close" className="text-[16px] font-bold text-white" />
              </span>
            ) : n.state === "skipped" ? (
              <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed border-gray-300 bg-gray-50">
                <Icon name="minimize" className="text-[16px] text-ink-faint" />
              </span>
            ) : (
              <span className="h-7 w-7 rounded-full border-2 border-gray-200 bg-white" />
            )}
            <span
              className={`text-xs leading-tight ${
                n.state === "todo" || n.state === "skipped"
                  ? "text-ink-faint"
                  : n.state === "rejected"
                    ? "font-semibold text-red-600"
                    : n.state === "current"
                      ? "font-semibold text-primary-dark"
                      : "font-medium text-ink"
              }`}
            >
              {n.name}
            </span>
            {n.sub && (
              <span
                className={`text-[11px] leading-tight ${n.alert ? "font-semibold text-red-600" : "text-ink-faint"}`}
              >
                {n.sub}
              </span>
            )}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/* ---------- Toast notifications ---------- */
export interface ToastMsg {
  id: number;
  type: "success" | "error";
  text: string;
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const counter = useRef(0);
  const push = useCallback((type: "success" | "error", text: string) => {
    counter.current += 1;
    const id = counter.current;
    setToasts((t) => [...t, { id, type, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return { toasts, push };
}

export function ToastStack({ toasts }: { toasts: ToastMsg[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-[200] flex w-[340px] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-dropdown flex items-start gap-2 rounded-md border px-4 py-3 text-sm shadow-lg bg-white"
          style={{
            borderColor: t.type === "success" ? "#bbf7d0" : "#fecaca",
          }}
        >
          <Icon
            name={t.type === "success" ? "check_circle" : "error"}
            className={`text-[20px] ${t.type === "success" ? "text-success" : "text-danger"}`}
            filled
          />
          <div className="flex-1 text-ink">{t.text}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Confirm dialog ---------- */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  note,
  confirmLabel = "Delete",
  danger = true,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  note?: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={title}>
      <div className="space-y-4">
        <div className="text-sm text-ink-soft">{message}</div>
        {note && (
          <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Icon name="warning" className="mt-px text-[16px]" />
            <span>{note}</span>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-surface-border pt-4">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className={danger ? "btn-danger" : "btn-primary"} onClick={onConfirm} disabled={busy}>
            {busy && <Icon name="progress_activity" className="animate-spin text-[18px]" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Row action dropdown menu ---------- */
export interface RowMenuItem {
  icon: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
}

export function RowMenu({ items }: { items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  if (items.length === 0) return null;
  return (
    <div className="relative inline-block" ref={ref}>
      <button className="icon-btn !h-8 !w-8" onClick={() => setOpen((o) => !o)} aria-label="Row actions">
        <Icon name="more_vert" />
      </button>
      {open && (
        <div className="animate-dropdown absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-md border border-surface-border bg-white py-1 shadow-lg">
          {items.map((it, i) => (
            <button
              key={i}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-muted ${
                it.danger ? "text-danger" : "text-ink"
              }`}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              <Icon name={it.icon} className="text-[18px]" />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Form field wrapper ---------- */
export function Field({
  label,
  required = false,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label">
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

/* ---------- Inline form error ---------- */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
      <Icon name="error" className="mt-px text-[16px]" />
      <span>{message}</span>
    </div>
  );
}
