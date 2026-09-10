"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { PageHeader, StatusBadge } from "@/components/ui";

interface ReqDetail {
  RequestID: string;
  TrackingNumber: string;
  Status: string;
  Priority: string;
  OraclePoNumber: string | null;
  Requester: { Name: string; Email: string };
  Assignee: { Name: string } | null;
  FormTemplate: { Name: string };
  FieldValues: { Value: string; FormField: { Label: string } }[];
  Items: {
    RequestedItemName: string;
    RequestedQuantity: number;
    ItemCode: string | null;
  }[];
  Approvals: { Decision: string; Comment: string | null; Approver: { Name: string }; WFStep: { StepName: string } }[];
  Comments: { CommentText: string; Author: { Name: string }; CreatedAt: string }[];
}

export default function RequestDetailPage() {
  const { token, user } = useAuth();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [req, setReq] = useState<ReqDetail | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch(`/api/requests/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setReq(await r.json());
  }

  useEffect(() => {
    if (token) load();
  }, [token, id]);

  async function act(action: string, extra: any = {}) {
    setBusy(true);
    const r = await fetch(`/api/requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...extra }),
    });
    setBusy(false);
    if (r.ok) load();
  }

  async function postComment() {
    if (!comment.trim()) return;
    await fetch(`/api/requests/${id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: comment }),
    });
    setComment("");
    load();
  }

  if (!req) return <AppShell><div className="p-6 text-ink-soft">Loading...</div></AppShell>;

  const perms = user?.permissions || [];
  const canApprove = perms.includes("REQUEST_APPROVE") && req.Status === "PENDING_APPROVAL";
  const canPo = perms.includes("REQUEST_REGISTER_PO") && req.Status === "APPROVED";
  const canAssign = perms.includes("REQUEST_ASSIGN");

  return (
    <AppShell>
      <PageHeader
        title={req.TrackingNumber}
        subtitle={`${req.FormTemplate.Name} · ${req.Requester.Name}`}
        action={<StatusBadge status={req.Status} />}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="card p-5">
            <h3 className="mb-3 font-semibold text-ink">Fields</h3>
            {req.FieldValues.length === 0 ? (
              <p className="text-sm text-ink-faint">No field values</p>
            ) : (
              <dl className="space-y-2 text-sm">
                {req.FieldValues.map((fv, i) => (
                  <div key={i} className="flex justify-between border-b border-surface-border pb-2">
                    <dt className="text-ink-soft">{fv.FormField?.Label}</dt>
                    <dd className="font-medium text-ink">{fv.Value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          <div className="card overflow-hidden">
            <h3 className="border-b border-surface-border bg-surface-muted px-5 py-3 font-semibold text-ink">
              Items ({req.Items.length})
            </h3>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-ink-soft">
                <tr>
                  <th className="px-5 py-2">Item</th>
                  <th className="px-5 py-2">Code</th>
                  <th className="px-5 py-2">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {req.Items.map((it, i) => (
                  <tr key={i}>
                    <td className="px-5 py-2">{it.RequestedItemName}</td>
                    <td className="px-5 py-2 text-ink-soft">{it.ItemCode || "—"}</td>
                    <td className="px-5 py-2">{it.RequestedQuantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {req.Approvals.length > 0 && (
            <div className="card p-5">
              <h3 className="mb-3 font-semibold text-ink">Approval History</h3>
              <div className="space-y-2 text-sm">
                {req.Approvals.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span
                      className={`badge ${
                        a.Decision === "APPROVED" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                      }`}
                    >
                      {a.Decision}
                    </span>
                    <span className="font-medium text-ink">{a.WFStep.StepName}</span>
                    <span className="text-ink-soft">by {a.Approver.Name}</span>
                    {a.Comment && <span className="text-ink-faint">— {a.Comment}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          {req.OraclePoNumber && (
            <div className="card bg-purple-50 p-5">
              <div className="text-xs font-semibold uppercase text-purple-700">Oracle PO</div>
              <div className="mt-1 text-lg font-bold text-purple-900">{req.OraclePoNumber}</div>
            </div>
          )}

          <div className="card p-5">
            <h3 className="mb-3 font-semibold text-ink">Actions</h3>
            <div className="space-y-2">
              {canApprove && (
                <>
                  <button className="btn-primary w-full" disabled={busy} onClick={() => act("APPROVE")}>
                    Approve
                  </button>
                  <button className="btn-danger w-full" disabled={busy} onClick={() => act("REJECT")}>
                    Reject
                  </button>
                </>
              )}
              {canPo && (
                <button
                  className="btn-primary w-full"
                  disabled={busy}
                  onClick={() => {
                    const po = prompt("Oracle PO Number:");
                    if (po) act("REGISTER_PO", { oraclePoNumber: po });
                  }}
                >
                  Register PO
                </button>
              )}
              {canAssign && !req.Assignee && (
                <button className="btn-secondary w-full" disabled={busy} onClick={() => act("ASSIGN")}>
                  Assign to me
                </button>
              )}
              {req.Status === "APPROVED" && perms.includes("REQUEST_FULFILL") && (
                <button className="btn-secondary w-full" disabled={busy} onClick={() => act("FULFILL_STOCK")}>
                  Mark Fulfilled
                </button>
              )}
            </div>
          </div>

          <div className="card p-5">
            <h3 className="mb-3 font-semibold text-ink">Comments</h3>
            <div className="space-y-3">
              {req.Comments.map((c, i) => (
                <div key={i} className="text-sm">
                  <div className="font-medium text-ink">{c.Author.Name}</div>
                  <div className="text-ink-soft">{c.CommentText}</div>
                </div>
              ))}
              <textarea
                className="input mt-2"
                rows={2}
                placeholder="Add a comment..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <button className="btn-secondary w-full" onClick={postComment}>
                Comment
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
