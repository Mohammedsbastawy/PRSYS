"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { Icon, StatusBadge } from "@/components/ui";

interface StepDraft {
  key: string;
  id?: string;
  stepName: string;
  approverType: string;
  targetUserId: string;
  targetGroupId: string;
  targetRoleId: string;
}

interface LoadedStep {
  WFStepID: string;
  StepName: string;
  StepOrder: number;
  ApproverType: string;
  TargetUserID: string | null;
  TargetGroupID: string | null;
  TargetRoleID: string | null;
}

interface LoadedWorkflow {
  WFDefinitionID: string;
  Name: string;
  Description: string | null;
  Status: string;
  Steps: LoadedStep[];
  Templates: { FormTemplateID: string; Name: string; Status: string }[];
  usage?: { templates: number; liveRequests: number; decisions: number };
}

interface TemplateRow {
  FormTemplateID: string;
  Name: string;
  Status: string;
  WFDefinitionID: string | null;
}

interface RoleRow {
  id: string;
  name: string;
}

interface GroupRow {
  id: string;
  name: string;
}

interface UserRow {
  UserID: string;
  Name: string;
  Email: string;
  Role?: { Name: string } | null;
}

const APPROVER_TYPES = [
  { value: "ANY_APPROVER", label: "Anyone with approval permission" },
  { value: "ROLE", label: "Specific role" },
  { value: "GROUP", label: "Specific group" },
  { value: "USER", label: "Specific user" },
  { value: "REQUESTER_MANAGER", label: "Requester's direct manager" },
];

let stepSeq = 0;
function nextKey(): string {
  stepSeq += 1;
  return `step-${Date.now()}-${stepSeq}`;
}

function blankStep(): StepDraft {
  return {
    key: nextKey(),
    stepName: "",
    approverType: "ANY_APPROVER",
    targetUserId: "",
    targetGroupId: "",
    targetRoleId: "",
  };
}

export default function WorkflowEditor({ workflowId }: { workflowId: string | null }) {
  const { user, token } = useAuth();
  const router = useRouter();
  const isNew = workflowId === null;
  const canManage =
    user?.role.code === "SUPER_ADMIN" || user?.permissions?.includes("WF_MANAGE") || false;

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [initialAssigned, setInitialAssigned] = useState<Set<string>>(new Set());
  const [usage, setUsage] = useState<LoadedWorkflow["usage"] | null>(null);

  useEffect(() => {
    if (!token) return;
    const h = { Authorization: `Bearer ${token}` };
    fetch("/api/roles", { headers: h })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: RoleRow[]) => setRoles(Array.isArray(d) ? d : []))
      .catch(() => setRoles([]));
    fetch("/api/groups", { headers: h })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: GroupRow[]) => setGroups(Array.isArray(d) ? d : []))
      .catch(() => setGroups([]));
    fetch("/api/users/lookup", { headers: h })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: UserRow[]) => setUsers(Array.isArray(d) ? d : []))
      .catch(() => setUsers([]));
    fetch("/api/form-templates", { headers: h })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: TemplateRow[]) => {
        const list = Array.isArray(d) ? d : [];
        setTemplates(list);
        if (!isNew && workflowId) {
          const ids = new Set(list.filter((t) => t.WFDefinitionID === workflowId).map((t) => t.FormTemplateID));
          setAssigned(ids);
          setInitialAssigned(new Set(ids));
        }
      })
      .catch(() => setTemplates([]));
    if (!isNew && workflowId) {
      setLoading(true);
      fetch(`/api/workflows/${workflowId}`, { headers: h })
        .then((r) => (r.ok ? r.json() : null))
        .then((w: LoadedWorkflow | null) => {
          if (!w) {
            setError("Workflow not found");
            return;
          }
          setName(w.Name);
          setDescription(w.Description ?? "");
          setStatus(w.Status);
          setUsage(w.usage ?? null);
          setSteps(
            (w.Steps || []).map((s) => ({
              key: nextKey(),
              id: s.WFStepID,
              stepName: s.StepName,
              approverType: s.ApproverType,
              targetUserId: s.TargetUserID ?? "",
              targetGroupId: s.TargetGroupID ?? "",
              targetRoleId: s.TargetRoleID ?? "",
            }))
          );
        })
        .catch(() => setError("Failed to load workflow"))
        .finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function patchStep(key: string, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  function moveStep(key: string, dir: -1 | 1) {
    setSteps((prev) => {
      const i = prev.findIndex((s) => s.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function removeStep(key: string) {
    setSteps((prev) => prev.filter((s) => s.key !== key));
  }

  function toggleTemplate(id: string) {
    setAssigned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setError("");
    if (!name.trim()) {
      setError("Workflow name is required");
      return;
    }
    for (const s of steps) {
      if (!s.stepName.trim()) {
        setError("Every step needs a name");
        return;
      }
      if (s.approverType === "ROLE" && !s.targetRoleId) {
        setError(`Step "${s.stepName}": choose a role`);
        return;
      }
      if (s.approverType === "GROUP" && !s.targetGroupId) {
        setError(`Step "${s.stepName}": choose a group`);
        return;
      }
      if (s.approverType === "USER" && !s.targetUserId) {
        setError(`Step "${s.stepName}": choose a user`);
        return;
      }
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        status,
        steps: steps.map((s, i) => ({
          ...(s.id ? { id: s.id } : {}),
          stepName: s.stepName.trim(),
          stepOrder: i,
          approverType: s.approverType,
          targetUserId: s.approverType === "USER" ? s.targetUserId || null : null,
          targetGroupId: s.approverType === "GROUP" ? s.targetGroupId || null : null,
          targetRoleId: s.approverType === "ROLE" ? s.targetRoleId || null : null,
        })),
      };
      const url = isNew ? "/api/workflows" : `/api/workflows/${workflowId}`;
      const r = await fetch(url, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({} as { error?: string; WFDefinitionID?: string }));
      if (!r.ok) {
        setError(d.error || "Save failed");
        return;
      }
      const savedId = isNew ? d.WFDefinitionID : workflowId;
      // sync template assignments (added -> link, removed -> unlink)
      const h = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      for (const tid of Array.from(assigned)) {
        if (initialAssigned.has(tid)) continue;
        await fetch(`/api/form-templates/${tid}`, {
          method: "PATCH",
          headers: h,
          body: JSON.stringify({ wfDefinitionId: savedId }),
        });
      }
      for (const tid of Array.from(initialAssigned)) {
        if (assigned.has(tid)) continue;
        await fetch(`/api/form-templates/${tid}`, {
          method: "PATCH",
          headers: h,
          body: JSON.stringify({ wfDefinitionId: null }),
        });
      }
      router.push("/workflows");
    } catch {
      setError("Save failed — check your connection");
    } finally {
      setSaving(false);
    }
  }

  const ro = !canManage;

  function targetControl(s: StepDraft) {
    if (s.approverType === "ROLE") {
      return (
        <select
          className="input"
          value={s.targetRoleId}
          disabled={ro}
          onChange={(e) => patchStep(s.key, { targetRoleId: e.target.value })}
          aria-label="Target role"
        >
          <option value="">Select role...</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      );
    }
    if (s.approverType === "GROUP") {
      return (
        <select
          className="input"
          value={s.targetGroupId}
          disabled={ro}
          onChange={(e) => patchStep(s.key, { targetGroupId: e.target.value })}
          aria-label="Target group"
        >
          <option value="">Select group...</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      );
    }
    if (s.approverType === "USER") {
      return (
        <select
          className="input"
          value={s.targetUserId}
          disabled={ro}
          onChange={(e) => patchStep(s.key, { targetUserId: e.target.value })}
          aria-label="Target user"
        >
          <option value="">Select user...</option>
          {users.map((u) => (
            <option key={u.UserID} value={u.UserID}>
              {u.Name} ({u.Email})
            </option>
          ))}
        </select>
      );
    }
    return (
      <p className="rounded bg-surface-muted px-3 py-2 text-xs text-ink-soft">
        {s.approverType === "REQUESTER_MANAGER"
          ? "Resolved per request from the requester's direct manager."
          : "Any user with approval permission can decide this step."}
      </p>
    );
  }

  return (
    <AppShell>
      <div className="mb-4">
        <Link
          href="/workflows"
          className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <Icon name="arrow_back" className="text-[18px]" /> Back to workflows
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-ink">
              {isNew ? "New Workflow" : `Edit Workflow: ${name || "..."}`}
            </h1>
            {!isNew && <StatusBadge status={status} />}
          </div>
          {canManage && (
            <button onClick={save} disabled={saving || loading} className="btn-primary disabled:opacity-50">
              <span className="inline-flex items-center gap-1.5">
                <Icon name="save" className="text-[18px]" />
                {saving ? "Saving..." : isNew ? "Create Workflow" : "Save Changes"}
              </span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}
      {usage && (usage.liveRequests > 0 || usage.decisions > 0) && (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {usage.liveRequests} live request{usage.liveRequests === 1 ? " is" : "s are"} on this
          workflow&apos;s steps
          {usage.decisions > 0 && `, with ${usage.decisions} past decision${usage.decisions === 1 ? "" : "s"}`}
          {" "}— steps in use cannot be removed.
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-ink-soft">Loading workflow...</div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <div className="card p-5">
              <h2 className="mb-4 text-base font-semibold text-ink">Workflow Settings</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label" htmlFor="wf-name">
                    Workflow Name <span className="text-danger">*</span>
                  </label>
                  <input
                    id="wf-name"
                    className="input"
                    value={name}
                    disabled={ro}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Standard Purchase Approval"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="wf-status">
                    Status
                  </label>
                  <select
                    id="wf-status"
                    className="input"
                    value={status}
                    disabled={ro}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="DRAFT">Draft</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="label" htmlFor="wf-desc">
                    Description
                  </label>
                  <textarea
                    id="wf-desc"
                    rows={2}
                    className="input"
                    value={description}
                    disabled={ro}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="When is this workflow used?"
                  />
                </div>
              </div>
            </div>

            <div className="card p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-ink">Approval Steps ({steps.length})</h2>
                {canManage && (
                  <button
                    onClick={() => setSteps((prev) => [...prev, blankStep()])}
                    className="inline-flex items-center gap-1 rounded border border-surface-border bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:border-primary hover:text-primary"
                  >
                    <Icon name="add" className="text-[16px]" /> Add step
                  </button>
                )}
              </div>
              <div className="space-y-3">
                {steps.map((s, i) => (
                  <div key={s.key} className="rounded border border-surface-border bg-surface p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink-faint">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] text-white">
                          {i + 1}
                        </span>
                        Step {i + 1}
                      </span>
                      {canManage && (
                        <span className="flex items-center gap-1">
                          <button
                            className="icon-btn !h-7 !w-7"
                            disabled={i === 0}
                            onClick={() => moveStep(s.key, -1)}
                            aria-label="Move up"
                          >
                            <Icon name="arrow_upward" className="text-[18px]" />
                          </button>
                          <button
                            className="icon-btn !h-7 !w-7"
                            disabled={i === steps.length - 1}
                            onClick={() => moveStep(s.key, 1)}
                            aria-label="Move down"
                          >
                            <Icon name="arrow_downward" className="text-[18px]" />
                          </button>
                          <button
                            className="icon-btn !h-7 !w-7 text-danger hover:bg-red-50"
                            onClick={() => removeStep(s.key)}
                            aria-label="Remove step"
                          >
                            <Icon name="delete" className="text-[18px]" />
                          </button>
                        </span>
                      )}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <label className="label">Step name</label>
                        <input
                          className="input"
                          value={s.stepName}
                          disabled={ro}
                          onChange={(e) => patchStep(s.key, { stepName: e.target.value })}
                          placeholder="e.g. Department Manager Approval"
                        />
                      </div>
                      <div>
                        <label className="label">Decided by</label>
                        <select
                          className="input"
                          value={s.approverType}
                          disabled={ro}
                          onChange={(e) =>
                            patchStep(s.key, {
                              approverType: e.target.value,
                              targetUserId: "",
                              targetGroupId: "",
                              targetRoleId: "",
                            })
                          }
                        >
                          {APPROVER_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="md:col-span-2">{targetControl(s)}</div>
                    </div>
                  </div>
                ))}
                {steps.length === 0 && (
                  <div className="rounded border border-dashed border-surface-border px-4 py-8 text-center text-sm text-ink-soft">
                    No steps yet — requests using this workflow will be auto-approved.
                    {canManage && " Add steps with the button above."}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="card p-5">
              <h2 className="mb-1 text-sm font-semibold text-ink">
                Linked Templates ({assigned.size})
              </h2>
              <p className="mb-3 text-xs text-ink-soft">
                Forms that route approvals through this workflow.
              </p>
              <div className="max-h-80 space-y-1.5 overflow-y-auto">
                {templates.map((t) => (
                  <label
                    key={t.FormTemplateID}
                    className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm ${
                      assigned.has(t.FormTemplateID)
                        ? "border-primary bg-blue-50/50"
                        : "border-surface-border"
                    } ${ro ? "cursor-default" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0"
                      checked={assigned.has(t.FormTemplateID)}
                      disabled={ro}
                      onChange={() => toggleTemplate(t.FormTemplateID)}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">{t.Name}</span>
                    <StatusBadge status={t.Status} />
                  </label>
                ))}
                {templates.length === 0 && (
                  <p className="py-4 text-center text-xs text-ink-faint">No form templates yet.</p>
                )}
              </div>
            </div>
            <div className="card p-5">
              <h2 className="mb-2 text-sm font-semibold text-ink">How it works</h2>
              <ul className="list-disc space-y-1.5 pl-5 text-xs text-ink-soft">
                <li>Steps run in order — each needs one decision to advance.</li>
                <li>Only the step&apos;s assignee can approve, reject or ask for clarification.</li>
                <li>Link forms here, or pick the workflow in a form&apos;s settings.</li>
                <li>Steps with live requests or history cannot be removed.</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
