"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { Icon, PageHeader, StatusBadge } from "@/components/ui";
import { SLA_BADGE, slaHealth } from "@/lib/sla";

interface Req {
  RequestID: string;
  TrackingNumber: string;
  Title: string | null;
  Status: string;
  Priority: string;
  CreatedAt: string;
  SubmittedAt: string | null;
  ResponseDueAt: string | null;
  ResolveDueAt: string | null;
  RespondedAt: string | null;
  ResolvedAt: string | null;
  Requester: { Name: string };
  FormTemplate: { Name: string };
  CurrentStep: { StepName: string } | null;
  _count: { Items: number; Approvals: number };
}

const FILTERS = [
  "",
  "DRAFT",
  "PENDING_APPROVAL",
  "CLARIFICATION_REQUESTED",
  "APPROVED",
  "PO_REGISTERED",
  "FULFILLED",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
];

const FILTER_LABELS: Record<string, string> = {
  "": "All",
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending",
  CLARIFICATION_REQUESTED: "Awaiting Reply",
  APPROVED: "Approved",
  PO_REGISTERED: "PO Registered",
  FULFILLED: "Fulfilled",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

const PRIORITIES = ["", "URGENT", "HIGH", "MEDIUM", "LOW"];

function priorityClass(p: string): string {
  if (p === "URGENT") return "bg-red-600 text-white";
  if (p === "HIGH") return "bg-red-100 text-red-700";
  if (p === "MEDIUM") return "bg-amber-100 text-amber-800";
  return "bg-gray-100 text-gray-600";
}

export default function RequestsPage() {
  const { user, token } = useAuth();
  const [items, setItems] = useState<Req[]>([]);
  const [filter, setFilter] = useState("");
  const [priority, setPriority] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!token) return;
    const qs = filter ? `?status=${filter}` : "";
    fetch(`/api/requests${qs}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Req[]) => setItems(Array.isArray(d) ? d : []))
      .catch(() => setItems([]));
  }, [token, filter]);

  const viewAll =
    user?.role.code === "SUPER_ADMIN" || user?.permissions?.includes("REQUEST_VIEW_ALL") || false;

  const needle = q.trim().toLowerCase();
  const visible = items.filter((r) => {
    if (priority && r.Priority !== priority) return false;
    if (!needle) return true;
    return [r.TrackingNumber, r.Title ?? "", r.Requester?.Name ?? "", r.FormTemplate?.Name ?? ""]
      .some((s) => s.toLowerCase().includes(needle));
  });

  return (
    <AppShell>
      <PageHeader
        title={viewAll ? "Requests" : "My Requests"}
        subtitle={viewAll ? "All purchase requests" : "Your purchase requests"}
        action={
          <Link href="/requests/new" className="btn-primary">
            + New Request
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint">
            <Icon name="search" className="text-[20px]" />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tracking, title, requester..."
            className="input !pl-9"
          />
        </div>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="input w-auto"
          aria-label="Filter by priority"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p === "" ? "Priority: All" : p.charAt(0) + p.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded px-3 py-1 text-sm font-medium ${
              filter === f
                ? "bg-primary text-white"
                : "border border-surface-border bg-white text-ink-soft hover:bg-surface-muted"
            }`}
          >
            {FILTER_LABELS[f] ?? f}
          </button>
        ))}
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase text-ink-soft">
            <tr>
              <th className="px-4 py-3">Reference / Title</th>
              <th className="px-4 py-3">Form</th>
              <th className="px-4 py-3">Requester</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Items</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {visible.map((r) => (
              <tr key={r.RequestID} className="hover:bg-surface-muted">
                <td className="px-4 py-3">
                  <Link href={`/requests/${r.RequestID}`} className="block font-medium text-primary">
                    {r.TrackingNumber}
                  </Link>
                  <span className="block truncate text-xs text-ink-soft">
                    {r.Title || "—"}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-soft">{r.FormTemplate?.Name}</td>
                <td className="px-4 py-3">{r.Requester?.Name}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${priorityClass(r.Priority)}`}>{r.Priority}</span>
                </td>
                <td className="px-4 py-3 text-ink-soft">{r._count?.Items}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.Status} />
                  {r.CurrentStep && (
                    <span className="block text-[11px] text-ink-faint">{r.CurrentStep.StepName}</span>
                  )}
                  {(() => {
                    const h = slaHealth(r);
                    if (h.state === "NONE") return null;
                    const b = SLA_BADGE[h.state];
                    return (
                      <span
                        className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${b.cls}`}
                        title={`SLA — respond: ${h.response}, resolve: ${h.resolve}`}
                      >
                        <Icon name={b.icon} className="text-[12px]" />
                        {b.label}
                      </span>
                    );
                  })()}
                </td>
                <td className="px-4 py-3 text-ink-faint">
                  {new Date(r.CreatedAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-faint">
                  No requests found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
