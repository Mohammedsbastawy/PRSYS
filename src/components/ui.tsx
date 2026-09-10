import { ReactNode } from "react";

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    DRAFT: "bg-gray-100 text-gray-700",
    PENDING_APPROVAL: "bg-amber-100 text-amber-800",
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
