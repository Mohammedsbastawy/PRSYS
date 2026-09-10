"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { EmptyState, Icon, WorkflowProgress } from "@/components/ui";

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

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="text-4xl font-bold tracking-tight text-ink">Welcome back, {firstName}</h1>
        <p className="mt-1 text-base text-ink-soft">Manage your requests and track approvals here.</p>
      </div>

      {data && data.myPendingApprovals > 0 && (
        <Link
          href="/requests"
          className="mb-8 flex items-center gap-4 rounded-lg border border-blue-200 bg-blue-50 px-5 py-4 transition-colors hover:border-primary"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white">
            <Icon name="inbox" />
          </span>
          <span className="flex-1">
            <span className="block font-semibold text-ink">
              {data.myPendingApprovals} request{data.myPendingApprovals === 1 ? "" : "s"} awaiting
              your decision
            </span>
            <span className="block text-sm text-ink-soft">
              Review and approve pending requests from your team
            </span>
          </span>
          <span className="flex items-center gap-1 text-sm font-semibold text-primary-dark">
            Review <Icon name="arrow_forward" className="text-[18px]" />
          </span>
        </Link>
      )}

      {/* Start a New Request */}
      <section className="mb-8 border-b border-surface-border pb-8">
        <h2 className="mb-4 text-xl font-semibold text-ink">Start a New Request</h2>
        {!data ? (
          <div className="py-6 text-sm text-ink-soft">Loading...</div>
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {data.templates.map((t) => (
              <Link
                key={t.FormTemplateID}
                href={`/requests/new?template=${t.FormTemplateID}`}
                className="card group flex h-full flex-col gap-3 p-4 transition-all hover:border-primary hover:shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-muted text-primary-dark transition-colors group-hover:bg-primary group-hover:text-white">
                  <Icon name={templateIcon(t.Name)} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-ink">{t.Name}</h3>
                  <p className="mt-1 line-clamp-2 text-[13px] text-ink-soft">
                    {t.Description || t.Category?.Name || "Start a new request"}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* My Recent Requests */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="text-xl font-semibold text-ink">My Recent Requests</h2>
          <Link
            href="/requests"
            className="flex items-center gap-1 text-sm font-semibold text-primary-dark hover:underline"
          >
            View all <Icon name="arrow_forward" className="text-[16px]" />
          </Link>
        </div>
        <div className="card overflow-hidden">
          {!data ? (
            <div className="px-4 py-8 text-center text-sm text-ink-soft">Loading...</div>
          ) : data.recent.length === 0 ? (
            <EmptyState
              icon="receipt_long"
              title="No requests yet"
              hint="When you submit a request, it will show up here with live approval progress."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl w-full min-w-[800px] text-left">
                <thead>
                  <tr>
                    <th className="w-[25%]">Request ID &amp; Title</th>
                    <th className="w-[15%]">Type</th>
                    <th className="w-[15%]">Date Submitted</th>
                    <th className="w-[45%]">Status</th>
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
                          <div className="text-sm font-semibold text-ink">{r.TrackingNumber}</div>
                          <div className="max-w-[220px] truncate text-[13px] text-ink-soft">
                            {reqTitle(r)}
                          </div>
                        </td>
                        <td className="text-[13px] text-ink">{r.FormTemplate?.Name}</td>
                        <td className="text-[13px] text-ink-soft">
                          {new Date(r.SubmittedAt || r.CreatedAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
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
    </AppShell>
  );
}
