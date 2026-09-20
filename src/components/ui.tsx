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
  "bg-[#a33900]",
  "bg-[#904d00]",
  "bg-[#3f661e]",
  "bg-[#cc4900]",
  "bg-[#6e3900]",
  "bg-[#2b5008]",
  "bg-[#7f2b00]",
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

/* ---------- Status pill (Warm Slate & Tangerine semantic chips) ---------- */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    DRAFT: "bg-surface-container text-on-surface-variant",
    ACTIVE: "bg-tertiary-fixed text-on-tertiary-fixed",
    PENDING_APPROVAL: "bg-secondary-fixed text-on-secondary-fixed",
    PROCESSING: "bg-secondary-fixed-dim/50 text-on-secondary-fixed-variant",
    CLARIFICATION_REQUESTED: "bg-secondary-container/30 text-on-secondary-container",
    APPROVED: "bg-primary-fixed text-on-primary-fixed",
    PO_REGISTERED: "bg-surface-container-high text-on-surface",
    FULFILLED: "bg-tertiary-fixed/60 text-on-tertiary-fixed-variant",
    REJECTED: "bg-error-container text-on-error-container",
    CANCELLED: "bg-surface-container text-outline",
    COMPLETED: "bg-tertiary-fixed text-on-tertiary-fixed",
  };
  const cls = map[status] || "bg-surface-container text-on-surface-variant";
  return (
    <span className={`badge ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor(status)}`} />
      {status.replace(/_/g, " ")}
    </span>
  );
}

function dotColor(status: string): string {
  const map: Record<string, string> = {
    DRAFT: "bg-outline",
    ACTIVE: "bg-tertiary",
    PENDING_APPROVAL: "bg-secondary",
    PROCESSING: "bg-secondary-fixed-dim",
    CLARIFICATION_REQUESTED: "bg-secondary-container",
    APPROVED: "bg-primary",
    PO_REGISTERED: "bg-on-surface-variant",
    FULFILLED: "bg-tertiary",
    REJECTED: "bg-error",
    CANCELLED: "bg-outline",
    COMPLETED: "bg-tertiary",
  };
  return map[status] || "bg-outline";
}

/* ---------- Priority chip ---------- */
export function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    LOW: "bg-surface-container text-on-surface-variant",
    MEDIUM: "bg-secondary-fixed text-on-secondary-fixed",
    HIGH: "bg-secondary-container/40 text-on-secondary-container",
    URGENT: "bg-error-container text-on-error-container",
  };
  const cls = map[priority] || "bg-surface-container text-on-surface-variant";
  return <span className={`badge ${cls}`}>{priority}</span>;
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
    return <span className="badge bg-surface-container font-medium text-on-surface-variant">Draft</span>;
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
              <div className={`mx-0.5 mt-[5px] h-0.5 min-w-[16px] flex-1 ${i <= activeIdx ? "bg-primary" : "bg-surface-container-highest"}`} />
            )}
            <div className="flex shrink-0 flex-col items-center gap-1">
              {rejected && isActive ? (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-error">
                  <Icon name="close" className="text-[11px] font-bold text-white" />
                </span>
              ) : done && i === last ? (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                  <Icon name="check" className="text-[11px] font-bold text-white" />
                </span>
              ) : isDone ? (
                <span className="h-2.5 w-2.5 rounded-full bg-primary" style={{ marginTop: 3, marginBottom: 3 }} />
              ) : isActive ? (
                <span className="h-3.5 w-3.5 rounded-full border-[2.5px] border-primary bg-surface-container-lowest" />
              ) : (
                <span className="h-2.5 w-2.5 rounded-full bg-surface-container-highest" style={{ marginTop: 3, marginBottom: 3 }} />
              )}
              {showLabel && (
                <span
                  title={s}
                  className={`max-w-[120px] truncate text-[11px] leading-tight ${
                    rejected && isActive
                      ? "font-semibold text-error"
                      : isActive
                        ? "font-semibold text-primary-dark"
                        : "text-outline"
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
            i < c ? "h-2 w-2 bg-primary" : i === c ? "h-2.5 w-2.5 bg-primary ring-2 ring-primary/25" : "h-2 w-2 bg-surface-container-highest"
          }`}
        />
      ))}
    </span>
  );
}

/* ---------- Page header ---------- */
export function PageHeader({
  kicker,
  title,
  subtitle,
  action,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-space-md md:flex-row md:items-end md:justify-between">
      <div className="space-y-1">
        {kicker && (
          <div className="flex items-center gap-space-xs">
            <span className="font-label-sm text-label-sm uppercase font-bold tracking-wider text-primary">{kicker}</span>
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            <span className="font-label-sm text-label-sm font-medium text-outline">PRSYS Workspace</span>
          </div>
        )}
        <h1 className="font-headline-lg text-headline-lg font-semibold tracking-tight text-on-surface">{title}</h1>
        {subtitle && <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-space-sm">{action}</div>}
    </div>
  );
}

/* ---------- Stat card (KPI) ---------- */
export function StatCard({
  label,
  value,
  color = "text-on-surface",
  icon,
  sub,
}: {
  label: string;
  value: number | string;
  color?: string;
  icon?: string;
  sub?: ReactNode;
}) {
  return (
    <div className="card group relative overflow-hidden p-space-lg transition-all hover:shadow-tier2">
      <div className="flex items-start justify-between">
        <span className="font-label-sm text-label-sm uppercase font-semibold text-outline">{label}</span>
        {icon && (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant transition-colors group-hover:bg-primary-fixed group-hover:text-primary">
            <Icon name={icon} className="text-[20px]" />
          </div>
        )}
      </div>
      <div className={`mt-space-sm font-headline-xl text-headline-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="mt-space-md font-body-sm text-body-sm text-on-surface-variant">{sub}</div>}
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
    <div className="flex items-center justify-between border-t border-surface-variant bg-surface-container-lowest px-4 py-3">
      <div className="font-label-md text-label-md text-on-surface-variant">
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
        <span className="min-w-[24px] text-center font-label-md text-label-md font-semibold text-on-surface">{page}</span>
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
      <div className="absolute inset-0 bg-on-surface/45 backdrop-blur-[4px]" onClick={onClose} />
      <div className={`animate-dropdown relative max-h-[90vh] w-full overflow-y-auto rounded-2xl bg-surface-container-lowest shadow-tier3 ${wide ? "max-w-3xl" : "max-w-lg"}`}>
        <div className="flex items-center justify-between border-b border-surface-variant px-5 py-4">
          <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface">{title}</h3>
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
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-container text-outline">
        <Icon name={icon} className="text-[26px]" />
      </span>
      <div className="font-headline-sm text-body-md font-semibold text-on-surface">{title}</div>
      {hint && <div className="max-w-sm text-sm text-on-surface-variant">{hint}</div>}
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
  isPreset?: boolean;
  icon?: string;
}

export function WorkflowTimeline({ nodes }: { nodes: TimelineNode[] }) {
  return (
    <div className="slim-scroll flex items-start overflow-x-auto py-2">
      {nodes.map((n, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <div
              className={`mx-1 mt-[15px] h-0.5 min-w-[24px] flex-1 ${
                nodes[i - 1].state === "done"
                  ? "bg-green-600"
                  : nodes[i - 1].state === "current"
                    ? "bg-primary"
                    : "bg-surface-container-highest"
              }`}
            />
          )}
          <div className="flex w-28 shrink-0 flex-col items-center gap-1.5 text-center">
            {n.state === "done" ? (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-600 shadow-sm" title={n.isPreset ? "Automation Preset completed" : undefined}>
                <Icon name="check" className="text-[17px] font-bold text-white" />
              </span>
            ) : n.state === "current" ? (
              <span
                title={n.isPreset ? "Automation Preset in progress" : "The request is waiting here"}
                className="relative flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-primary bg-surface-container-lowest shadow-[0_0_0_4px_rgba(163,57,0,0.14)]"
              >
                <span className="absolute h-full w-full animate-ping rounded-full bg-primary/15" />
                <span className="relative h-3 w-3 rounded-full bg-primary" />
              </span>
            ) : n.state === "rejected" ? (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-error" title={n.isPreset ? "Automation Preset rejected" : undefined}>
                <Icon name="close" className="text-[17px] font-bold text-white" />
              </span>
            ) : n.state === "skipped" ? (
              <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-surface-container-highest bg-surface-container-low">
                <Icon name="minimize" className="text-[17px] text-outline" />
              </span>
            ) : (
              <span className="h-8 w-8 rounded-full border-2 border-surface-variant bg-surface-container-lowest" />
            )}
            {n.isPreset && (
              <span className="inline-flex items-center gap-1 rounded bg-secondary-fixed/70 px-1.5 py-0.5 text-[9px] font-bold text-on-secondary-fixed-variant">
                <Icon name={n.icon || "tune"} className="text-[11px]" /> Preset
              </span>
            )}
            <span
              className={`text-xs leading-tight ${
                n.state === "todo" || n.state === "skipped"
                  ? "text-outline"
                  : n.state === "rejected"
                    ? "font-semibold text-error"
                    : n.state === "current"
                      ? "font-bold text-primary-dark"
                      : "font-medium text-on-surface"
              }`}
            >
              {n.name}
            </span>
            {n.state === "current" && (
              <span className="-mt-1 rounded-full bg-primary-fixed px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                Waiting here
              </span>
            )}
            {n.sub && (
              <span
                className={`text-[11px] leading-tight ${n.alert ? "font-semibold text-error" : "text-outline"}`}
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
          className="animate-dropdown flex items-start gap-2 rounded-md border px-4 py-3 text-sm shadow-tier2 bg-surface-container-lowest"
          style={{
            borderColor: t.type === "success" ? "#bbf7d0" : "#fecaca",
          }}
        >
          <Icon
            name={t.type === "success" ? "check_circle" : "error"}
            className={`text-[20px] ${t.type === "success" ? "text-success" : "text-danger"}`}
            filled
          />
          <div className="flex-1 text-on-surface">{t.text}</div>
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
        <div className="text-sm text-on-surface-variant">{message}</div>
        {note && (
          <div className="flex items-start gap-2 rounded border border-secondary-fixed-dim bg-secondary-fixed px-3 py-2 text-xs text-on-secondary-fixed-variant">
            <Icon name="warning" className="mt-px text-[16px]" />
            <span>{note}</span>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-surface-variant pt-4">
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
        <div className="animate-dropdown absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-xl border border-surface-variant bg-surface-container-lowest py-1 shadow-lg">
          {items.map((it, i) => (
            <button
              key={i}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-container-low ${
                it.danger ? "text-danger" : "text-on-surface"
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
      {hint && <p className="mt-1 text-xs text-outline">{hint}</p>}
    </div>
  );
}

/* ---------- Inline form error ---------- */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded border border-transparent bg-error-container px-3 py-2 text-xs text-on-error-container">
      <Icon name="error" className="mt-px text-[16px]" />
      <span>{message}</span>
    </div>
  );
}
