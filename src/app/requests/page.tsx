"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { EmptyState, Icon, PageHeader, PriorityBadge, StatusBadge } from "@/components/ui";
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
  Requester: { Name: string } | null;
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
  "PROCESSING",
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
  PROCESSING: "Processing",
  PO_REGISTERED: "PO Registered",
  FULFILLED: "Fulfilled",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

const PRIORITIES = ["", "URGENT", "HIGH", "MEDIUM", "LOW"];

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
        kicker="Operations"
        title={viewAll ? "Requests" : "My Requests"}
        subtitle={viewAll ? "All purchase requests across the organization" : "Your purchase requests and their approval progress"}
        action={
          <Link href="/requests/new" className="btn-primary">
            <Icon name="add" className="text-[18px]" />
            <span>New Request</span>
          </Link>
        }
      />

      {/* Filter bar */}
      <div className="card mb-space-md flex flex-col gap-space-md p-space-md lg:flex-row lg:items-center">
        <div className="relative min-w-[220px] flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline">
            <Icon name="search" className="text-[18px]" />
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
          className="input w-auto lg:w-44"
          aria-label="Filter by priority"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p === "" ? "Priority: All" : p.charAt(0) + p.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <span className="font-label-sm text-label-sm text-outline lg:ml-auto">
          {visible.length} result{visible.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Status chips */}
      <div className="mb-space-md flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3.5 py-1.5 font-label-md text-label-md font-semibold transition-colors ${
              filter === f
                ? "bg-primary text-on-primary shadow-cta"
                : "border border-surface-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
            }`}
          >
            {FILTER_LABELS[f] ?? f}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState
            icon="receipt_long"
            title="No requests found"
            hint="Try adjusting the filters, or start a new request."
            action={
              <Link href="/requests/new" className="btn-primary">
                <Icon name="add" className="text-[18px]" /> New Request
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl w-full min-w-[900px]">
              <thead>
                <tr>
                  <th>Reference / Title</th>
                  <th>Form</th>
                  <th>Requester</th>
                  <th>Priority</th>
                  <th className="text-right">Items</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.RequestID}>
                    <td>
                      <Link href={`/requests/${r.RequestID}`} className="font-label-lg text-label-lg font-semibold text-primary hover:underline">
                        {r.TrackingNumber}
                      </Link>
                      <span className="block max-w-[260px] truncate font-body-sm text-body-md text-on-surface-variant">
                        {r.Title || "—"}
                      </span>
                    </td>
                    <td className="font-body-md text-body-md text-on-surface-variant">{r.FormTemplate?.Name}</td>
                    <td className="font-body-md text-body-md text-on-surface">{r.Requester?.Name}</td>
                    <td>
                      <PriorityBadge priority={r.Priority} />
                    </td>
                    <td className="text-right font-label-md text-label-md font-semibold text-on-surface">
                      {r._count?.Items}
                    </td>
                    <td>
                      <StatusBadge status={r.Status} />
                      {r.CurrentStep && (
                        <span className="mt-1 block font-body-sm text-body-sm text-outline">{r.CurrentStep.StepName}</span>
                      )}
                      {(() => {
                        const h = slaHealth(r);
                        if (h.state === "NONE") return null;
                        const b = SLA_BADGE[h.state];
                        return (
                          <span
                            className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-label-sm text-label-sm font-bold ${b.cls}`}
                            title={`SLA — respond: ${h.response}, resolve: ${h.resolve}`}
                          >
                            <Icon name={b.icon} className="text-[12px]" />
                            {b.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="font-body-md text-body-md text-on-surface-variant">
                      {new Date(r.CreatedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
