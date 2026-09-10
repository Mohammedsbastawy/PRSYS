"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { PageHeader, StatusBadge } from "@/components/ui";

interface Req {
  RequestID: string;
  TrackingNumber: string;
  Status: string;
  Priority: string;
  CreatedAt: string;
  Requester: { Name: string };
  FormTemplate: { Name: string };
  _count: { Items: number; Approvals: number };
}

const FILTERS = ["", "DRAFT", "PENDING_APPROVAL", "APPROVED", "PO_REGISTERED", "FULFILLED", "REJECTED"];

export default function RequestsPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<Req[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!token) return;
    const q = filter ? `?status=${filter}` : "";
    fetch(`/api/requests${q}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setItems);
  }, [token, filter]);

  return (
    <AppShell>
      <PageHeader
        title="Requests"
        subtitle="All purchase requests"
        action={
          <Link href="/requests/new" className="btn-primary">
            + New Request
          </Link>
        }
      />
      <div className="mb-4 flex gap-2">
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
            {f || "All"}
          </button>
        ))}
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase text-ink-soft">
            <tr>
              <th className="px-4 py-3">Tracking #</th>
              <th className="px-4 py-3">Form</th>
              <th className="px-4 py-3">Requester</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Items</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {items.map((r) => (
              <tr key={r.RequestID} className="hover:bg-surface-muted">
                <td className="px-4 py-3">
                  <Link href={`/requests/${r.RequestID}`} className="font-medium text-primary">
                    {r.TrackingNumber}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink-soft">{r.FormTemplate?.Name}</td>
                <td className="px-4 py-3">{r.Requester?.Name}</td>
                <td className="px-4 py-3">
                  <span className="badge bg-gray-100 text-gray-600">{r.Priority}</span>
                </td>
                <td className="px-4 py-3 text-ink-soft">{r._count?.Items}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.Status} />
                </td>
                <td className="px-4 py-3 text-ink-faint">
                  {new Date(r.CreatedAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
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
