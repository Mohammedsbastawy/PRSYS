"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { PageHeader, StatusBadge, Icon } from "@/components/ui";

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
  OnDemand?: boolean;
  CanvasJson?: string | null;
  Steps?: WFStep[];
}

export default function AutomationPresetsPage() {
  const { user, token } = useAuth();
  const [presets, setPresets] = useState<WF[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const canManage =
    user?.role.code === "SUPER_ADMIN" || user?.permissions?.includes("WF_MANAGE") || false;

  function load() {
    if (!token) return;
    setLoading(true);
    fetch("/api/workflows", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: WF[]) => {
        const list = Array.isArray(d) ? d : [];
        setPresets(list.filter((w) => Boolean(w.OnDemand)));
      })
      .catch(() => setPresets([]))
      .finally(() => setLoading(false));
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
        title="Automation Presets"
        subtitle="On-demand actions and automated approval presets available inside tickets"
        action={
          canManage ? (
            <Link href="/workflows/new?preset=true" className="btn-primary flex items-center gap-1.5">
              <Icon name="add" className="text-[18px]" />
              New Automation Preset
            </Link>
          ) : undefined
        }
      />

      {error && (
        <div className="mb-4 rounded border border-error/25 bg-error-container/60 px-4 py-3 text-sm font-medium text-on-error-container">
          {error}
        </div>
      )}

      {loading ? (
        <div className="card p-8 text-center text-sm text-outline">Loading presets…</div>
      ) : presets.length === 0 ? (
        <div className="card p-12 text-center">
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
            <Icon name="tune" className="text-[30px]" />
          </span>
          <h3 className="text-base font-bold text-on-surface">No Automation Presets yet</h3>
          <p className="mx-auto mt-1 max-w-md text-xs text-on-surface-variant">
            Automation presets are on-demand workflows (like Budget Approvals, Fast Actions, or Maintenance sign-offs) that agents and authorized users can run directly from tickets.
          </p>
          {canManage && (
            <div className="mt-5">
              <Link href="/workflows/new?preset=true" className="btn-primary inline-flex items-center gap-1.5">
                <Icon name="add" className="text-[18px]" />
                Create your first Preset
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {presets.map((w) => {
            const confirming = confirmId === w.WFDefinitionID;
            let icon = "tune";
            let audienceText = "Everyone";
            try {
              if (w.CanvasJson) {
                const parsed = JSON.parse(w.CanvasJson);
                if (parsed.presetIcon) icon = parsed.presetIcon;
                if (parsed.presetAudience) {
                  const a = parsed.presetAudience;
                  if (a.mode === "ROLES") audienceText = `${a.roleIds?.length ?? 0} Role(s)`;
                  else if (a.mode === "DEPARTMENTS") audienceText = `${a.depIds?.length ?? 0} Dept(s)`;
                  else if (a.mode === "GROUPS") audienceText = `${a.groupIds?.length ?? 0} Group(s)`;
                }
              }
            } catch {}

            return (
              <div key={w.WFDefinitionID} className="card p-4 transition-shadow hover:shadow-md">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3.5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                      <Icon name={icon} className="text-[22px]" />
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-on-surface text-base">{w.Name}</h3>
                        <StatusBadge status={w.Status} />
                        <span className="badge border border-primary/20 bg-primary/5 text-[10px] font-bold text-primary">
                          Preset
                        </span>
                        <span className="badge border border-surface-variant bg-surface-container text-[10px] font-medium text-on-surface-variant">
                          Audience: {audienceText}
                        </span>
                      </div>
                      {w.Description && (
                        <p className="mt-1 text-xs text-on-surface-variant">{w.Description}</p>
                      )}
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-outline">
                        <span>{w.Steps?.length ?? 0} step(s)</span>
                      </div>
                    </div>
                  </div>

                  <span className="inline-flex items-center gap-3 text-xs font-semibold">
                    <Link href={`/workflows/${w.WFDefinitionID}`} className="text-primary hover:underline">
                      {canManage ? "Edit Preset" : "View"}
                    </Link>
                    {canManage &&
                      (confirming ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="font-medium text-on-surface-variant">Delete?</span>
                          <button
                            onClick={() => remove(w.WFDefinitionID)}
                            className="font-bold text-danger hover:underline"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="text-on-surface-variant hover:underline"
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmId(w.WFDefinitionID)}
                          className="text-danger hover:underline"
                        >
                          Delete
                        </button>
                      ))}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
