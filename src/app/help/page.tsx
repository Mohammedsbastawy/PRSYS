"use client";

import AppShell from "@/components/AppShell";
import { Icon, PageHeader, StatusBadge } from "@/components/ui";

const FAQS = [
  {
    icon: "add_circle",
    q: "How do I create a new request?",
    a: "From the Dashboard, pick a request type under “Start a New Request”. Fill in the form fields, add the items you need, then Save Draft or Submit. Once submitted, your request enters the approval workflow automatically.",
  },
  {
    icon: "timeline",
    q: "How do I track my request?",
    a: "Open “My Requests” (or “Requests”) to see every request with its live approval progress. Click any row for full details, comments, attached files and the complete approval history.",
  },
  {
    icon: "mark_email_read",
    q: "I'm an approver — where is my queue?",
    a: "Requests waiting for your decision appear in the Requests list with the “Pending Approval” status. Open a request to Approve, Reject, or ask for clarification, and add a comment with your decision.",
  },
  {
    icon: "inventory_2",
    q: "What happens after approval?",
    a: "Approved requests go to the procurement team, who verify items against stock and the Oracle catalog, register the Oracle PO number, and mark the request fulfilled once delivered.",
  },
];

const STATUSES = [
  ["DRAFT", "Saved but not submitted yet. Only you can see it."],
  ["PENDING_APPROVAL", "Submitted and waiting for an approver decision."],
  ["CLARIFICATION_REQUESTED", "An approver asked for more information — reply with a comment."],
  ["APPROVED", "Fully approved — handed over to procurement."],
  ["PO_REGISTERED", "Procurement registered the Oracle purchase order."],
  ["FULFILLED", "Items issued from stock or delivered."],
  ["COMPLETED", "Request closed and completed."],
  ["REJECTED", "Rejected by an approver — see the comments for the reason."],
  ["CANCELLED", "Cancelled — no further action will be taken."],
];

export default function HelpPage() {
  return (
    <AppShell>
      <PageHeader title="Help & Support" subtitle="How PRSYS works, at a glance" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {FAQS.map((f) => (
          <div key={f.q} className="card flex gap-4 p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-primary-dark">
              <Icon name={f.icon} />
            </span>
            <div>
              <div className="font-semibold text-ink">{f.q}</div>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">{f.a}</p>
            </div>
          </div>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold text-ink">Request statuses</h2>
      <div className="card divide-y divide-surface-border">
        {STATUSES.map(([s, d]) => (
          <div key={s} className="flex items-center gap-4 px-5 py-3">
            <span className="w-48 shrink-0">
              <StatusBadge status={s} />
            </span>
            <span className="text-sm text-ink-soft">{d}</span>
          </div>
        ))}
      </div>

      <div className="card mt-6 flex items-center gap-4 bg-blue-50/50 p-5">
        <Icon name="support_agent" className="text-[32px] text-primary-dark" />
        <div>
          <div className="font-semibold text-ink">Still need help?</div>
          <div className="text-sm text-ink-soft">
            Contact your IT support team or your system administrator for access and technical
            issues.
          </div>
        </div>
      </div>
    </AppShell>
  );
}
