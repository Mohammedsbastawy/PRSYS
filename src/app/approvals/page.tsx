"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { Icon, PageHeader, StatusBadge } from "@/components/ui";

interface QueueItem {
  id: string;
  tracking: string;
  title: string | null;
  status: string;
  priority: string;
  submittedAt: string;
  daysPending: number;
  requester: string;
  department: { id: string; name: string } | null;
  type: string;
  stepName: string | null;
  stepIndex: number;
  stepCount: number;
  itemCount: number;
  totalValue: number;
}

interface HistoryItem {
  id: string;
  decision: string;
  comment: string | null;
  decidedAt: string;
  stepName: string;
  request: {
    id: string;
    tracking: string;
    title: string | null;
    status: string;
    requester: string;
    form: string;
  };
}

interface FilterOption {
  id: string;
  name: string;
}

interface CatRow {
  FormCategoryID: string;
  Name: string;
}

interface DepRow {
  DEPID: string;
  Name: string;
}

const PAGE_SIZE = 10;

function daysLabel(n: number): string {
  if (n <= 0) return "<1 day";
  return n === 1 ? "1 day" : `${n} days`;
}

function agingClass(n: number): string {
  if (n >= 14) return "bg-red-100 font-semibold text-red-700";
  if (n >= 7) return "bg-amber-100 font-semibold text-amber-800";
  return "text-ink";
}

function dotClass(i: number, current: number, muted: boolean): string {
  if (muted) return i <= current && current >= 0 ? "bg-gray-400" : "bg-gray-200";
  if (i < current) return "bg-primary";
  if (i === current) return "bg-primary ring-2 ring-blue-200";
  return "bg-gray-300";
}

function StepDots({
  total,
  current,
  muted,
  title,
}: {
  total: number;
  current: number;
  muted?: boolean;
  title?: string;
}) {
  if (total <= 0) return <span className="text-xs text-ink-faint">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-2 w-2 rounded-full ${dotClass(i, current, !!muted)}`} />
      ))}
    </span>
  );
}

function Pager({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  return (
    <div className="flex items-center justify-between border-t border-surface-border px-4 py-3 text-sm text-ink-soft">
      <span>
        Showing {from}–{to} of {total} entries
      </span>
      <span className="flex items-center gap-1">
        <button
          className="icon-btn !h-8 !w-8 disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <Icon name="chevron_left" className="text-[20px]" />
        </button>
        <span className="min-w-[2rem] text-center font-semibold text-ink">{page}</span>
        <button
          className="icon-btn !h-8 !w-8 disabled:opacity-40"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <Icon name="chevron_right" className="text-[20px]" />
        </button>
      </span>
    </div>
  );
}

export default function ApprovalsPage() {
  const { user, token } = useAuth();
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [histLoaded, setHistLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cats, setCats] = useState<FilterOption[]>([]);
  const [depts, setDepts] = useState<FilterOption[]>([]);
  const [type, setType] = useState("");
  const [dept, setDept] = useState("");
  const [sort, setSort] = useState("oldest");
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [page, setPage] = useState(1);

  const canApprove =
    user?.role.code === "SUPER_ADMIN" ||
    user?.permissions?.includes("REQUEST_APPROVE") ||
    false;

  useEffect(() => {
    if (!token || !canApprove) return;
    const h = { Authorization: `Bearer ${token}` };
    fetch("/api/form-categories", { headers: h })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: CatRow[]) =>
        setCats((d || []).map((c) => ({ id: c.FormCategoryID, name: c.Name })))
      )
      .catch(() => setCats([]));
    fetch("/api/departments", { headers: h })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: DepRow[]) => setDepts((d || []).map((x) => ({ id: x.DEPID, name: x.Name }))))
      .catch(() => setDepts([]));
  }, [token, canApprove]);

  useEffect(() => {
    const t = setTimeout(() => {
      setAppliedQ(q.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!token || !canApprove) return;
    setLoading(true);
    const p = new URLSearchParams({ mode: "pending", sort });
    if (type) p.set("type", type);
    if (dept) p.set("dept", dept);
    if (appliedQ) p.set("q", appliedQ);
    fetch(`/api/approvals?${p.toString()}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: QueueItem[]) => setQueue(Array.isArray(d) ? d : []))
      .catch(() => setQueue([]))
      .finally(() => setLoading(false));
  }, [token, canApprove, type, dept, sort, appliedQ]);

  useEffect(() => {
    if (!token || !canApprove || tab !== "history" || histLoaded) return;
    fetch("/api/approvals?mode=history", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: HistoryItem[]) => {
        setHistory(Array.isArray(d) ? d : []);
        setHistLoaded(true);
      })
      .catch(() => setHistory([]));
  }, [token, canApprove, tab, histLoaded]);

  if (!user) {
    return (
      <AppShell>
        <div className="py-16 text-center text-sm text-ink-soft">Loading...</div>
      </AppShell>
    );
  }

  if (!canApprove) {
    return (
      <AppShell>
        <PageHeader title="Approvals" subtitle="Decide on requests waiting for you" />
        <div className="card flex flex-col items-center gap-2 px-4 py-12 text-center">
          <Icon name="lock" className="text-[32px] text-ink-faint" />
          <div className="font-semibold text-ink">No approval permission</div>
          <div className="text-sm text-ink-soft">
            Your account cannot approve requests. Contact your administrator if this is a mistake.
          </div>
        </div>
      </AppShell>
    );
  }

  const start = (page - 1) * PAGE_SIZE;
  const pageQueue = queue.slice(start, start + PAGE_SIZE);
  const pageHistory = history.slice(start, start + PAGE_SIZE);
  const awaitingReply = queue.filter((i) => i.status === "CLARIFICATION_REQUESTED").length;

  return (
    <AppShell>
      <PageHeader
        title="My Approval Queue"
        subtitle={
          queue.length === 0
            ? "Nothing waiting for your decision"
            : `${queue.length} request${queue.length === 1 ? "" : "s"} awaiting your decision${
                awaitingReply > 0 ? ` (${awaitingReply} awaiting requester reply)` : ""
              }`
        }
      />

      <div className="mb-4 flex gap-1 border-b border-surface-border">
        <button
          onClick={() => {
            setTab("pending");
            setPage(1);
          }}
          className={`px-4 py-2 text-sm font-semibold ${
            tab === "pending"
              ? "border-b-2 border-primary text-primary"
              : "text-ink-soft hover:text-ink"
          }`}
        >
          Pending ({queue.length})
        </button>
        <button
          onClick={() => {
            setTab("history");
            setPage(1);
          }}
          className={`px-4 py-2 text-sm font-semibold ${
            tab === "history"
              ? "border-b-2 border-primary text-primary"
              : "text-ink-soft hover:text-ink"
          }`}
        >
          Approval History{histLoaded ? ` (${history.length})` : ""}
        </button>
      </div>

      {tab === "pending" && (
        <>
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
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
              className="input w-auto"
              aria-label="Filter by request type"
            >
              <option value="">Type: All</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={dept}
              onChange={(e) => {
                setDept(e.target.value);
                setPage(1);
              }}
              className="input w-auto"
              aria-label="Filter by department"
            >
              <option value="">Department: All</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
              className="input w-auto"
              aria-label="Sort queue"
            >
              <option value="oldest">Sort By: Oldest First</option>
              <option value="newest">Sort By: Newest First</option>
              <option value="value">Sort By: Highest Value</option>
            </select>
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase text-ink-soft">
                <tr>
                  <th className="px-4 py-3">Reference / Title</th>
                  <th className="px-4 py-3">Requester</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3">Days Pending</th>
                  <th className="px-4 py-3">Current Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {pageQueue.map((item) => {
                  const awaiting = item.status === "CLARIFICATION_REQUESTED";
                  return (
                    <tr key={item.id} className="hover:bg-surface-muted">
                      <td className="px-4 py-3">
                        {awaiting && (
                          <span className="badge mb-1 bg-gray-200 text-gray-700">
                            Awaiting reply
                          </span>
                        )}
                        <Link
                          href={`/requests/${item.id}`}
                          className="block font-medium text-primary"
                        >
                          {item.tracking}
                        </Link>
                        <span className="block truncate text-xs text-ink-soft">
                          {item.title || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">{item.requester}</td>
                      <td className="px-4 py-3 text-ink-soft">
                        {item.department?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-ink-soft">
                        {item.type}
                        {item.totalValue > 0 && (
                          <span className="block text-[11px] text-ink-faint">
                            est. {item.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-soft">
                        {new Date(item.submittedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${agingClass(item.daysPending)}`}
                        >
                          {item.daysPending >= 7 && (
                            <Icon name="warning" className="text-[16px]" />
                          )}
                          {daysLabel(item.daysPending)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StepDots
                          total={item.stepCount}
                          current={item.stepIndex}
                          muted={awaiting}
                          title={item.stepName ?? undefined}
                        />
                        {item.stepName && (
                          <span className="block text-[11px] text-ink-faint">{item.stepName}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {awaiting ? (
                          <Link
                            href={`/requests/${item.id}`}
                            className="text-xs font-semibold text-primary hover:underline"
                          >
                            View
                          </Link>
                        ) : (
                          <Link
                            href={`/requests/${item.id}`}
                            className="inline-block rounded border border-primary px-3 py-1.5 text-xs font-semibold text-primary hover:bg-blue-50"
                          >
                            Review
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {pageQueue.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center">
                      <Icon name="inbox" className="text-[28px] text-ink-faint" />
                      <div className="mt-1 text-sm font-medium text-ink">
                        {loading ? "Loading queue..." : "Your queue is clear"}
                      </div>
                      {!loading && (
                        <div className="text-xs text-ink-soft">
                          Nothing is waiting for your decision right now.
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <Pager page={page} total={queue.length} onPage={setPage} />
          </div>
        </>
      )}

      {tab === "history" && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase text-ink-soft">
              <tr>
                <th className="px-4 py-3">Reference / Title</th>
                <th className="px-4 py-3">Requester</th>
                <th className="px-4 py-3">Decision</th>
                <th className="px-4 py-3">Step</th>
                <th className="px-4 py-3">Comment</th>
                <th className="px-4 py-3">Decided</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {pageHistory.map((h) => (
                <tr key={h.id} className="hover:bg-surface-muted">
                  <td className="px-4 py-3">
                    <Link href={`/requests/${h.request.id}`} className="block font-medium text-primary">
                      {h.request.tracking}
                    </Link>
                    <span className="block truncate text-xs text-ink-soft">
                      {h.request.title || h.request.form}
                    </span>
                  </td>
                  <td className="px-4 py-3">{h.request.requester}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={h.decision} />
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{h.stepName}</td>
                  <td className="max-w-[240px] truncate px-4 py-3 text-ink-soft">
                    {h.comment || "—"}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">
                    {h.decidedAt
                      ? new Date(h.decidedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/requests/${h.request.id}`}
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
              {pageHistory.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center">
                    <Icon name="history" className="text-[28px] text-ink-faint" />
                    <div className="mt-1 text-sm font-medium text-ink">
                      {!histLoaded ? "Loading history..." : "No decisions yet"}
                    </div>
                    {histLoaded && (
                      <div className="text-xs text-ink-soft">
                        Requests you approve or reject will appear here.
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Pager page={page} total={history.length} onPage={setPage} />
        </div>
      )}
    </AppShell>
  );
}
