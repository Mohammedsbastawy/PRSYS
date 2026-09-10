import { Fragment, ReactNode, useEffect } from "react";

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
