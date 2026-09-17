"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { EmptyState, Icon, StatCard, StatusBadge, WorkflowProgress } from "@/components/ui";

interface WFStep {
  WFStepID: string;
  StepName: string;
}
interface RecentReq {
  RequestID: string;
  TrackingNumber: string;
  Title: string | null;
  Status: string;
  CurrentWFStepID: string | null;
  SubmittedAt: string | null;
  CreatedAt: string;
  FormTemplate: { Name: string; Workflow: { Steps: WFStep[] } | null };
  Approvals: { WFStepID: string; Decision: string }[];
  Items: { RequestedItemName: string }[];
}
interface Template {
  FormTemplateID: string;
  Name: string;
  Description: string | null;
  Category: { Name: string } | null;
}
interface Dash {
  total: number;
  byStatus: Record<string, number>;
  myPendingApprovals: number;
  recent: RecentReq[];
  templates: Template[];
}

function templateIcon(name: string): string {
  const n = name.toLowerCase();
  if (/raw|material|inventory|stock|warehouse/.test(n)) return "inventory_2";
  if (/\bit\b|laptop|computer|software|equipment|device/.test(n)) return "devices";
  if (/travel|flight|trip|hotel/.test(n)) return "flight";
  if (/vendor|payment|invoice|financ/.test(n)) return "payments";
  if (/expense|reimburse/.test(n)) return "receipt_long";
  if (/hr|leave|employee|staff/.test(n)) return "badge";
  if (/maintenance|repair|facility/.test(n)) return "build";
  if (/purchase|procure|general|request/.test(n)) return "shopping_cart";
  return "description";
}

function progressOf(r: RecentReq): { steps: string[]; current: number } {
  const wf = r.FormTemplate?.Workflow?.Steps ?? [];
  if (wf.length === 0) {
    return { steps: ["Submitted", "Approved"], current: r.Status === "DRAFT" ? 0 : 1 };
  }
  const steps = ["Submitted", ...wf.map((s) => s.StepName)];
  const idx = wf.findIndex((s) => s.WFStepID === r.CurrentWFStepID);
  if (idx >= 0) return { steps, current: idx + 1 };
  const decided = r.Approvals.filter((a) => a.Decision === "APPROVED").length;
  return { steps, current: Math.min(decided + 1, steps.length - 1) };
}

function reqTitle(r: RecentReq): string {
  return r.Title || r.Items?.[0]?.RequestedItemName || r.FormTemplate?.Name || "—";
}

export default function DashboardPage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Dash | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch("/api/dashboard", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [token]);

  const firstName = (user?.name || "").split(" ")[0] || "there";
  const canManageForms = user?.permissions?.includes("FORM_TEMPLATE_MANAGE");
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <AppShell>
      <div className="flex w-full flex-col space-y-space-lg">
        {/* ---------- Hero banner ---------- */}
        <div className="relative overflow-hidden rounded-2xl bg-surface-container-low p-space-lg shadow-tier1">
          <div className="pointer-events-none absolute -right-16 -top-16 h-80 w-80 rounded-full bg-gradient-to-br from-primary-fixed/40 via-secondary-fixed/30 to-transparent blur-2xl" />
          <div className="relative z-10 flex flex-col justify-between gap-space-md md:flex-row md:items-center">
            <div className="space-y-1">
              <div className="flex items-center gap-space-xs">
                <span className="font-label-sm text-label-sm font-bold uppercase tracking-wider text-primary">
                  {greeting}
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                <span className="font-label-sm text-label-sm font-medium text-outline">
                  {user?.role.name}
                </span>
              </div>
              <h1 className="font-headline-lg text-headline-lg font-semibold tracking-tight text-on-surface">
                Welcome back, {firstName}
              </h1>
              <p className="max-w-2xl font-body-md text-body-md text-on-surface-variant">
                Manage your requests and track approvals here.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-space-sm self-start md:self-auto">
              <Link href="/requests/new" className="btn-primary">
                <Icon name="add" className="text-[18px]" />
                <span>New Request</span>
              </Link>
            </div>
          </div>
        </div>

        {/* ---------- Pending approvals alert ---------- */}
        {data && data.myPendingApprovals > 0 && (
          <Link
            href="/approvals"
            className="flex items-center gap-4 rounded-2xl border-l-4 border-primary bg-primary-fixed/50 p-space-md transition-colors hover:bg-primary-fixed"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary">
              <Icon name="inbox" className="text-[22px]" />
            </span>
            <span className="flex-1">
              <span className="block font-headline-sm text-body-md font-semibold text-on-surface">
                {data.myPendingApprovals} request{data.myPendingApprovals === 1 ? "" : "s"} awaiting your decision
              </span>
              <span className="block font-body-sm text-body-md text-on-surface-variant">
                Review and approve pending requests from your team
              </span>
            </span>
            <span className="flex items-center gap-1 font-label-md text-label-md font-semibold text-primary">
              Review <Icon name="arrow_forward" className="text-[18px]" />
            </span>
          </Link>
        )}

        {/* ---------- KPI row ---------- */}
        <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Requests" value={data?.total ?? "—"} icon="receipt_long" />
          <StatCard
            label="Pending Approval"
            value={data ? data.byStatus.pending : "—"}
            color="text-primary"
            icon="hourglass_top"
          />
          <StatCard
            label="Approved"
            value={data ? data.byStatus.approved : "—"}
            color="text-tertiary"
            icon="task_alt"
          />
          <StatCard
            label="Fulfilled"
            value={data ? data.byStatus.fulfilled : "—"}
            color="text-tertiary"
            icon="check_circle"
          />
        </div>

        {/* ---------- Start a New Request ---------- */}
        <section>
          <div className="mb-space-md flex items-center justify-between">
            <h2 className="font-headline-md text-headline-md font-semibold text-on-surface">
              Start a New Request
            </h2>
            <Link href="/requests/new" className="flex items-center gap-1 font-label-md text-label-md font-semibold text-primary hover:underline">
              Browse all <Icon name="arrow_forward" className="text-[16px]" />
            </Link>
          </div>
          {!data ? (
            <div className="py-6 text-sm text-on-surface-variant">Loading...</div>
          ) : data.templates.length === 0 ? (
            <div className="card">
              <EmptyState
                icon="description"
                title="No request forms available yet"
                hint="Your administrator hasn't published any request forms. Once available, they'll appear here."
                action={
                  canManageForms ? (
                    <Link href="/forms" className="btn-primary">
                      Manage Forms
                    </Link>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-gutter md:grid-cols-2 lg:grid-cols-4">
              {data.templates.map((t) => (
                <Link
                  key={t.FormTemplateID}
                  href={`/requests/new?template=${t.FormTemplateID}`}
                  className="card group flex h-full flex-col gap-space-sm p-space-md transition-all hover:shadow-tier2"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-fixed text-primary transition-colors group-hover:bg-primary group-hover:text-on-primary">
                    <Icon name={templateIcon(t.Name)} className="text-[22px]" />
                  </div>
                  <div>
                    <h3 className="font-headline-sm text-body-md font-semibold text-on-surface">{t.Name}</h3>
                    <p className="mt-1 line-clamp-2 font-body-sm text-body-sm text-on-surface-variant">
                      {t.Description || t.Category?.Name || "Start a new request"}
                    </p>
                  </div>
                  <span className="mt-auto flex items-center gap-1 pt-1 font-label-md text-label-md font-semibold text-primary">
                    Open form <Icon name="arrow_forward" className="text-[14px]" />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* ---------- My Recent Requests ---------- */}
        <section>
          <div className="mb-space-md flex items-center justify-between">
            <h2 className="font-headline-md text-headline-md font-semibold text-on-surface">My Recent Requests</h2>
            <Link href="/requests" className="flex items-center gap-1 font-label-md text-label-md font-semibold text-primary hover:underline">
              View all <Icon name="arrow_forward" className="text-[16px]" />
            </Link>
          </div>
          <div className="card overflow-hidden">
            {!data ? (
              <div className="px-4 py-8 text-center text-sm text-on-surface-variant">Loading...</div>
            ) : data.recent.length === 0 ? (
              <EmptyState
                icon="receipt_long"
                title="No requests yet"
                hint="When you submit a request, it will show up here with live approval progress."
                action={
                  <Link href="/requests/new" className="btn-primary">
                    <Icon name="add" className="text-[18px]" /> Start your first request
                  </Link>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl w-full min-w-[800px] text-left">
                  <thead>
                    <tr>
                      <th className="w-[25%]">Request ID &amp; Title</th>
                      <th className="w-[15%]">Type</th>
                      <th className="w-[15%]">Date Submitted</th>
                      <th className="w-[15%]">Status</th>
                      <th className="w-[30%]">Approval Flow</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((r) => {
                      const p = progressOf(r);
                      return (
                        <tr
                          key={r.RequestID}
                          className="cursor-pointer"
                          onClick={() => router.push(`/requests/${r.RequestID}`)}
                        >
                          <td>
                            <div className="font-label-lg text-label-lg font-semibold text-on-surface">
                              {r.TrackingNumber}
                            </div>
                            <div className="max-w-[220px] truncate font-body-sm text-body-md text-on-surface-variant">
                              {reqTitle(r)}
                            </div>
                          </td>
                          <td className="font-body-md text-body-md text-on-surface">{r.FormTemplate?.Name}</td>
                          <td className="font-body-md text-body-md text-on-surface-variant">
                            {new Date(r.SubmittedAt || r.CreatedAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </td>
                          <td>
                            <StatusBadge status={r.Status} />
                          </td>
                          <td>
                            <WorkflowProgress steps={p.steps} current={p.current} status={r.Status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
