"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { PageHeader, StatusBadge } from "@/components/ui";
import { describeStepTarget } from "@/lib/workflow-targets";

interface WFStep {
  WFStepID: string;
  StepName: string;
  ApproverType: string;
  TargetUserID: string | null;
  TargetGroupID: string | null;
  TargetRoleID: string | null;
  TargetUser?: { Name: string } | null;
  TargetGroup?: { Name: string } | null;
  TargetRole?: { Name: string } | null;
}

interface WF {
  WFDefinitionID: string;
  Name: string;
  Description: string | null;
  Status: string;
  Steps?: WFStep[];
  Templates?: { FormTemplateID: string; Name: string; Status: string }[];
  _count?: { Templates: number };
}

export default function WorkflowsPage() {
  const { user, token } = useAuth();
  const [wfs, setWfs] = useState<WF[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const canManage =
    user?.role.code === "SUPER_ADMIN" || user?.permissions?.includes("WF_MANAGE") || false;

  function load() {
    if (!token) return;
    fetch("/api/workflows", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: WF[]) => setWfs(Array.isArray(d) ? d : []))
      .catch(() => setWfs([]));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function remove(id: string) {
    setError("");
    try {
      const r = await fetch(`/api/workflows/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok) {
        setError(d.error || "Delete failed");
        setConfirmId(null);
        return;
      }
      setConfirmId(null);
      load();
    } catch {
      setError("Delete failed — check your connection");
      setConfirmId(null);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Workflows"
        subtitle="Approval workflow definitions"
        action={
          canManage ? (
            <Link href="/workflows/new" className="btn-primary">
              + New Workflow
            </Link>
          ) : undefined
        }
      />
      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}
      <div className="space-y-4">
        {wfs.map((w) => {
          const inUse = w._count?.Templates ?? w.Templates?.length ?? 0;
          const confirming = confirmId === w.WFDefinitionID;
          return (
            <div key={w.WFDefinitionID} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-ink">{w.Name}</h3>
                    <StatusBadge status={w.Status} />
                  </div>
                  {w.Description && (
                    <p className="mt-1 text-sm text-ink-soft">{w.Description}</p>
                  )}
                  <p className="mt-1 text-xs text-ink-faint">
                    Used by {inUse} template{inUse === 1 ? "" : "s"}
                    {w.Templates && w.Templates.length > 0 && (
                      <>: {w.Templates.map((t) => t.Name).join(", ")}</>
                    )}
                  </p>
                </div>
                <span className="inline-flex items-center gap-3 text-xs font-semibold">
                  <Link href={`/workflows/${w.WFDefinitionID}`} className="text-primary hover:underline">
                    {canManage ? "Edit" : "View"}
                  </Link>
                  {canManage &&
                    (confirming ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="font-medium text-ink-soft">Delete?</span>
                        <button
                          onClick={() => remove(w.WFDefinitionID)}
                          className="font-bold text-danger hover:underline"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="text-ink-soft hover:underline"
                        >
                          No
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmId(w.WFDefinitionID)}
                        disabled={inUse > 0}
                        title={inUse > 0 ? "Used by templates — cannot delete" : "Delete workflow"}
                        className="text-danger hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline"
                      >
                        Delete
                      </button>
                    ))}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                {(w.Steps || []).map((s, i) => (
                  <span key={s.WFStepID} className="flex items-center gap-2">
                    <span
                      className="rounded bg-surface-muted px-2 py-1 text-ink-soft"
                      title={describeStepTarget(s)}
                    >
                      {i + 1}. {s.StepName}{" "}
                      <span className="text-xs text-ink-faint">({describeStepTarget(s)})</span>
                    </span>
                    {i < (w.Steps || []).length - 1 && <span className="text-ink-faint">→</span>}
                  </span>
                ))}
                {(w.Steps || []).length === 0 && (
                  <span className="text-sm italic text-ink-faint">
                    No steps — requests are auto-approved
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {wfs.length === 0 && <p className="text-ink-faint">No workflows yet</p>}
      </div>
    </AppShell>
  );
}
