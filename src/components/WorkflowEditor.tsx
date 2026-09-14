"use client";

/**
 * Workflow builder — a blank canvas of blocks you add yourself.
 *
 * There are no pre-baked sections and no fixed "submit → approvals → close"
 * shape: every block is created here, in the order you want, and each block
 * declares for itself when it runs and what it does.
 *
 *   APPROVAL block   who decides, quorum, due, comment policy, where the flow
 *                    goes on approve / on reject, and when it applies at all
 *   AUTOMATION block one action (priority / SLA / assign / notify / jump) plus
 *                    its own "runs after …" binding and its own condition
 *
 * Persistence reuses what already exists (no migration):
 *   APPROVAL   → WFSteps (StepOrder = position among approval blocks)
 *   AUTOMATION → WFRules { Trigger, ActionValue: { …action, fireOnStepOrder } }
 * where the bound step is the nearest APPROVAL block above it, so dragging a
 * block between two approvals re-targets it automatically.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { Icon, StatusBadge } from "@/components/ui";
import {
  CONDITION_FIELDS,
  NUMERIC_OPS,
  PRIORITY_OPS,
  PRIORITY_VALUES,
  validateConditionInput,
} from "@/lib/workflow-conditions";
import { RULE_ACTIONS } from "@/lib/workflow-rules";
import {
  apiToBlocks,
  blocksToApi,
  boundApprovalIndex,
  approvalNameAt,
  cloneBlock,
  newBlock,
  patchBy,
  type ActionKind,
  type Block,
  type BlockType,
  type Decision,
  type RunScope,
} from "@/lib/workflow-builder";

/* ------------------------------------------------------------------ model -- */

/* --------------------------------------------------------------- options -- */

const APPROVER_TYPES: { value: string; label: string; icon: string; hint: string }[] = [
  {
    value: "DEPARTMENT_MANAGER",
    label: "Department manager",
    icon: "apartment",
    hint: "Per request: the requester's department Manager, else their direct manager.",
  },
  {
    value: "REQUESTER_MANAGER",
    label: "Direct manager",
    icon: "account_balance",
    hint: "Per request: Users → Direct manager, else the department manager.",
  },
  { value: "GROUP", label: "Group", icon: "groups", hint: "Every member of the group can decide." },
  { value: "ROLE", label: "Role", icon: "admin_panel_settings", hint: "Every active user holding the role." },
  { value: "USER", label: "One person", icon: "person", hint: "A single named approver." },
  {
    value: "ANY_APPROVER",
    label: "Any approver",
    icon: "how_to_reg",
    hint: "Anyone with the approve permission. Super Admins are excluded on purpose.",
  },
];

const QUORUMS = [
  { value: "ANY_ONE", label: "First answer wins" },
  { value: "ALL", label: "Everyone must approve" },
];

const REJECT_ACTIONS = [
  { value: "REJECT_COMPLETELY", label: "Reject the request" },
  { value: "RETURN_TO_REQUESTER", label: "Return to requester" },
  { value: "RETURN_TO_PREVIOUS_STEP", label: "Send back a step" },
];

const APPROVE_ACTIONS = [
  { value: "CONTINUE", label: "Go to the next block" },
  { value: "APPROVE_COMPLETELY", label: "Approve and stop" },
  { value: "JUMP_TO_STEP", label: "Jump to another block" },
];

const COMMENT_POLICIES = [
  { value: "OPTIONAL", label: "Comment optional" },
  { value: "ON_REJECT", label: "Required to reject" },
  { value: "ON_APPROVE", label: "Required to approve" },
  { value: "ALWAYS", label: "Always required" },
];

const ACTION_META: Record<ActionKind, { label: string; icon: string; ring: string; text: string }> = {
  SET_PRIORITY: { label: "Set priority", icon: "priority_high", ring: "border-amber-200", text: "text-amber-700" },
  SET_SLA: { label: "Apply SLA", icon: "timer", ring: "border-violet-200", text: "text-violet-700" },
  ASSIGN_TO_USER: { label: "Assign owner", icon: "assignment_ind", ring: "border-sky-200", text: "text-sky-700" },
  NOTIFY: { label: "Notify", icon: "notifications_active", ring: "border-blue-200", text: "text-blue-700" },
  JUMP_TO_STEP: { label: "Jump to block", icon: "subdirectory_arrow_right", ring: "border-rose-200", text: "text-rose-700" },
};

const SCOPE_LABELS: Record<RunScope, string> = {
  AFTER_STEP: "After a block's decision",
  ANY_STEP: "After any approval block",
  SUBMIT: "Right after submit",
  FINAL_APPROVED: "After the whole request is approved",
  FINAL_REJECTED: "After the whole request is rejected",
};

/* ----------------------------------------------------------------- utils --- */

/* ------------------------------------------------------------ data shapes -- */

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
}
interface SlaRow {
  id: string;
  name: string;
  isDefault: boolean;
}
interface TemplateRow {
  FormTemplateID: string;
  Name: string;
  Status: string;
  WFDefinitionID: string | null;
}
interface LoadedStep {
  WFStepID: string;
  StepName: string;
  StepOrder: number;
  ApproverType: string;
  TargetUserID: string | null;
  TargetGroupID: string | null;
  TargetRoleID: string | null;
  ApprovalMode: string | null;
  RejectAction: string | null;
  ApproveAction: string | null;
  ApproveTargetStepID: string | null;
  Condition: string | null;
  DueDays: number | null;
  CommentPolicy: string | null;
}
interface LoadedRule {
  RuleID: string;
  Name: string;
  Trigger: string;
  Condition: string | null;
  Action: string;
  ActionValue: string | null;
  IsActive: boolean;
}
interface LoadedWorkflow {
  WFDefinitionID: string;
  Name: string;
  Description: string | null;
  Status: string;
  Steps: LoadedStep[];
  Rules?: LoadedRule[];
  usage?: { templates: number; liveRequests: number; decisions: number };
}

/* ----------------------------------------------------------- small pieces -- */

function whenSummary(b: Block, blocks: Block[]): string {
  if (b.type !== "ACTION") return "";
  const dec = b.decision === "BOTH" ? "approve or reject" : b.decision === "REJECTED" ? "reject" : "approve";
  if (b.scope === "AFTER_STEP") {
    const i = boundApprovalIndex(blocks, blocks.indexOf(b));
    return i < 0 ? "no approval block above it yet" : `after “${approvalNameAt(blocks, i)}” ${dec}`;
  }
  if (b.scope === "ANY_STEP") return `after any block ${dec}`;
  return SCOPE_LABELS[b.scope].toLowerCase();
}

function condText(b: Block): string | null {
  if (b.condField === "none") return null;
  return `${b.condField} ${b.condOp} ${b.condValue}`;
}

function Segmented({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors ${
            value === o.value
              ? "border-primary bg-blue-50 text-primary-dark"
              : "border-surface-border bg-white text-ink-soft hover:bg-surface-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ConditionRow({
  field,
  op,
  value,
  onChange,
  disabled,
}: {
  field: string;
  op: string;
  value: string;
  onChange: (p: { condField: string; condOp: string; condValue: string }) => void;
  disabled?: boolean;
}) {
  const isPriority = field === "priority";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="input w-auto !py-1.5 text-xs"
        disabled={disabled}
        value={field}
        onChange={(e) =>
          onChange({
            condField: e.target.value,
            condOp: e.target.value === "priority" ? "in" : ">=",
            condValue: e.target.value === "none" ? "" : value,
          })
        }
      >
        {CONDITION_FIELDS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      {field !== "none" && (
        <>
          <select
            className="input w-auto !py-1.5 text-xs"
            disabled={disabled}
            value={op}
            onChange={(e) => onChange({ condField: field, condOp: e.target.value, condValue: value })}
          >
            {(isPriority ? PRIORITY_OPS : NUMERIC_OPS).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {isPriority ? (
            <select
              className="input w-auto !py-1.5 text-xs"
              disabled={disabled}
              value={value}
              onChange={(e) => onChange({ condField: field, condOp: op, condValue: e.target.value })}
            >
              {PRIORITY_VALUES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value="HIGH,URGENT">HIGH or URGENT</option>
            </select>
          ) : (
            <input
              className="input !w-28 !py-1.5 text-xs"
              disabled={disabled}
              inputMode="numeric"
              placeholder="value"
              value={value}
              onChange={(e) => onChange({ condField: field, condOp: op, condValue: e.target.value })}
            />
          )}
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function Palette({
  onPick,
  onClose,
}: {
  onPick: (t: BlockType) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-surface-border bg-white p-2 shadow-sm">
      <span className="px-1 text-[11px] font-bold uppercase tracking-wider text-ink-faint">Add block</span>
      <button
        type="button"
        onClick={() => onPick("APPROVAL")}
        className="flex items-center gap-1.5 rounded border border-surface-border px-2.5 py-1.5 text-xs font-semibold text-ink hover:border-primary hover:bg-blue-50"
      >
        <Icon name="verified_user" className="text-[16px]" /> Approval
      </button>
      <button
        type="button"
        onClick={() => onPick("ACTION")}
        className="flex items-center gap-1.5 rounded border border-surface-border px-2.5 py-1.5 text-xs font-semibold text-ink hover:border-primary hover:bg-blue-50"
      >
        <Icon name="bolt" className="text-[16px]" /> Automation
      </button>
      <button type="button" onClick={onClose} className="icon-btn !h-7 !w-7 ml-auto" title="Cancel">
        <Icon name="close" className="text-[16px]" />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------- app -- */

export default function WorkflowEditor({ workflowId }: { workflowId: string | null }) {
  const { user, token } = useAuth();
  const router = useRouter();
  const isNew = workflowId === null;
  const canManage = user?.role.code === "SUPER_ADMIN" || (user?.permissions?.includes("WF_MANAGE") ?? false);
  const ro = !canManage;

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [usage, setUsage] = useState<LoadedWorkflow["usage"] | null>(null);

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [slas, setSlas] = useState<SlaRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [initialAssigned, setInitialAssigned] = useState<Set<string>>(new Set());

  const [paletteAt, setPaletteAt] = useState<number | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const baseline = useRef("");
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  const approvals = useMemo(() => blocks.filter((b) => b.type === "APPROVAL"), [blocks]);

  const dirty = useMemo(
    () => JSON.stringify({ name, description, status, blocks }) !== baseline.current,
    [name, description, status, blocks]
  );

  /* ------------------------------------------------------------- loaders -- */

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
    fetch("/api/sla-policies", { headers: h })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: SlaRow[]) => setSlas(Array.isArray(d) ? d : []))
      .catch(() => setSlas([]));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const applyLoaded = useCallback((w: LoadedWorkflow) => {
    const next = apiToBlocks(w.Steps || [], w.Rules || []);
    setName(w.Name);
    setDescription(w.Description ?? "");
    setStatus(w.Status);
    setUsage(w.usage ?? null);
    setBlocks(next);
    baseline.current = JSON.stringify({
      name: w.Name,
      description: w.Description ?? "",
      status: w.Status,
      blocks: next,
    });
  }, []);

  useEffect(() => {
    if (isNew || !token) return;
    setLoading(true);
    fetch(`/api/workflows/${workflowId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((w: LoadedWorkflow | null) => {
        if (!w) setError("Workflow not found");
        else applyLoaded(w);
      })
      .catch(() => setError("Failed to load workflow"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, workflowId, isNew]);

  /* ---------------------------------------------------------- block edits -- */

  const patchBlock = (key: string, p: Partial<Block>) => setBlocks((prev) => patchBy(prev, key, p));

  const insertAt = (index: number, type: BlockType) => {
    setBlocks((prev) => {
      const next = [...prev];
      next.splice(index, 0, newBlock(type, type === "APPROVAL" ? { name: `Approval ${countApprovals(next) + 1}` } : {}));
      return next;
    });
    setPaletteAt(null);
  };

  const moveBlock = (key: string, dir: -1 | 1) =>
    setBlocks((prev) => {
      const i = prev.findIndex((b) => b.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const removeBlock = (key: string) => setBlocks((prev) => prev.filter((b) => b.key !== key));

  const duplicateBlock = (key: string) =>
    setBlocks((prev) => {
      const i = prev.findIndex((b) => b.key === key);
      if (i < 0) return prev;
      const next = [...prev];
      next.splice(i + 1, 0, cloneBlock(prev[i], { name: `${prev[i].name || "Block"} (copy)` }));
      return next;
    });

  const onDrop = (targetIndex: number) => {
    if (!dragKey) return;
    setBlocks((prev) => {
      const from = prev.findIndex((b) => b.key === dragKey);
      if (from < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      const to = targetIndex > from ? targetIndex - 1 : targetIndex;
      next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
      return next;
    });
    setDragKey(null);
    setDragOver(null);
  };

  function countApprovals(list: Block[]): number {
    return list.filter((b) => b.type === "APPROVAL").length;
  }

  /* ------------------------------------------------------------ validation -- */

  interface Issue {
    text: string;
    key?: string;
  }
  const issues = useMemo<Issue[]>(() => {
    const out: Issue[] = [];
    if (!name.trim()) out.push({ text: "Give the workflow a name" });
    blocks.forEach((b, i) => {
      const label = b.name.trim() || (b.type === "APPROVAL" ? `Approval ${i + 1}` : `Automation ${i + 1}`);
      const at = (t: string) => out.push({ text: `“${label}”: ${t}`, key: b.key });
      const cErr = validateConditionInput(b.condField === "none" ? null : b.condField, b.condOp, b.condValue);
      if (cErr) at(cErr);

      if (b.type === "APPROVAL") {
        if (!b.name.trim()) at("needs a name");
        if (b.approverType === "ROLE" && !b.targetRoleId) at("choose a role");
        if (b.approverType === "GROUP" && !b.targetGroupId) at("choose a group");
        if (b.approverType === "USER" && !b.targetUserId) at("choose an approver");
        if (b.dueDays.trim() !== "") {
          const n = Number(b.dueDays);
          if (!Number.isInteger(n) || n < 1 || n > 365) at("due days must be a whole number from 1 to 365");
        }
        if (b.approveAction === "JUMP_TO_STEP") {
          if (!b.approveTargetKey) at("choose the block to jump to");
          else if (b.approveTargetKey === b.key) at("cannot jump to itself");
        }
      } else {
        if (!b.enabled) return;
        if (b.scope === "AFTER_STEP" && boundApprovalIndex(blocks, i) < 0)
          at("it is set to run after a block's decision but there is no approval block above it — move it below one, or change “runs after”");
        if (b.actionKind === "SET_SLA" && !b.slaPolicyId) at("choose an SLA policy");
        if (b.actionKind === "ASSIGN_TO_USER" && !b.userId) at("choose the user to assign");
        if (b.actionKind === "JUMP_TO_STEP" && !b.jumpToStepKey) at("choose the block to land on");
        if (b.actionKind === "NOTIFY") {
          if (b.notifyTargetType === "USER" && !b.notifyUserId) at("choose the user to notify");
          if (b.notifyTargetType === "GROUP" && !b.notifyGroupId) at("choose the group to notify");
          if (b.notifyTargetType === "ROLE" && !b.notifyRoleId) at("choose the role to notify");
        }
      }
    });
    if (approvals.length === 0 && blocks.some((b) => b.type === "ACTION" && b.scope === "AFTER_STEP"))
      out.push({ text: "There are no approval blocks, so nothing can trigger a step-level action" });
    return out;
  }, [name, blocks, approvals]);

  const focus = (key?: string) => {
    if (!key) return;
    setBlocks((prev) => prev.map((b) => (b.key === key ? { ...b, open: true } : b)));
    refs.current[key]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /* ----------------------------------------------------------------- save -- */

  async function save() {
    setError("");
    if (issues.length > 0) {
      setError(issues[0].text);
      focus(issues[0].key);
      return;
    }
    const built = blocksToApi(blocks, { slas, users });
    if (built.skipped.length > 0) {
      const first = built.skipped[0];
      setError(`An automation block is set to run after a decision but sits above every approval block — move it below one.`);
      focus(first.key);
      return;
    }
    const { steps, rules } = built;

    const body = {
      name: name.trim(),
      description: description.trim() || null,
      status,
      steps,
      rules,
    };

    setSaving(true);
    try {
      const res = await fetch(isNew ? "/api/workflows" : `/api/workflows/${workflowId}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({} as { error?: string; WFDefinitionID?: string }));
      if (!res.ok) {
        setError(d.error || "Save failed");
        return;
      }
      const savedId = isNew ? d.WFDefinitionID : workflowId;
      const h = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      for (const tid of Array.from(assigned)) {
        if (!initialAssigned.has(tid))
          await fetch(`/api/form-templates/${tid}`, {
            method: "PATCH",
            headers: h,
            body: JSON.stringify({ wfDefinitionId: savedId }),
          });
      }
      for (const tid of Array.from(initialAssigned)) {
        if (!assigned.has(tid))
          await fetch(`/api/form-templates/${tid}`, {
            method: "PATCH",
            headers: h,
            body: JSON.stringify({ wfDefinitionId: null }),
          });
      }
      baseline.current = JSON.stringify({ name, description, status, blocks });
      setInitialAssigned(new Set(assigned));
      setSavedAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
      if (isNew && savedId) router.replace(`/workflows/${savedId}`);
      else router.refresh();
    } catch {
      setError("Save failed — check your connection");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!ro && dirty) save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ro, dirty, issues, blocks, name, description, status]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  /* ------------------------------------------------------------ rendering -- */

  if (!canManage) {
    return (
      <AppShell>
        <div className="card mx-auto mt-10 max-w-md p-6 text-center text-sm text-ink-soft">
          You need the workflow management permission to open this screen.
        </div>
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell>
        <div className="py-16 text-center text-sm text-ink-soft">Loading workflow…</div>
      </AppShell>
    );
  }

  const actionCount = blocks.filter((b) => b.type === "ACTION" && b.enabled).length;

  return (
    <AppShell>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href="/workflows" className="icon-btn !h-7 !w-7" title="Back to workflows">
              <Icon name="arrow_back" className="text-[18px]" />
            </Link>
            <input
              className="min-w-0 flex-1 border-b border-transparent bg-transparent text-2xl font-bold tracking-tight text-ink outline-none hover:border-surface-border focus:border-primary"
              value={name}
              disabled={ro}
              placeholder="Untitled workflow"
              onChange={(e) => setName(e.target.value)}
            />
            <StatusBadge status={status} />
          </div>
          <input
            className="mt-1 w-full border-none bg-transparent pl-9 text-sm text-ink-soft outline-none placeholder:text-ink-faint"
            value={description}
            disabled={ro}
            placeholder="What is this flow for? (optional)"
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="mt-1 flex flex-wrap items-center gap-3 pl-9 text-[11px] text-ink-faint">
            <span>{approvals.length} approval block{approvals.length === 1 ? "" : "s"}</span>
            <span>{actionCount} automation{actionCount === 1 ? "" : "s"}</span>
            {usage && <span>{usage.templates} form(s) · {usage.liveRequests} live · {usage.decisions} decisions</span>}
            <select className="input w-auto !py-0.5 text-[11px]" disabled={ro} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ACTIVE">Active</option>
              <option value="DRAFT">Draft</option>
            </select>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 lg:pt-6">
          {savedAt && !dirty && <span className="text-[11px] text-ink-faint">saved {savedAt}</span>}
          {dirty && <span className="badge bg-amber-100 text-amber-800">unsaved changes</span>}
          <button onClick={save} disabled={saving || ro || (!dirty && !isNew)} className="btn-primary">
            <Icon name="save" className="text-[18px]" />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-danger">
          <Icon name="error" className="mt-0.5 text-[18px]" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-12">
        {/* canvas */}
        <div className="xl:col-span-8">
          <div className="mx-auto max-w-3xl space-y-2">
            {blocks.length === 0 && (
              <div className="card flex flex-col items-center gap-3 p-10 text-center">
                <Icon name="account_tree" className="text-[34px] text-ink-faint" />
                <p className="text-sm font-semibold text-ink">Your canvas is empty — build the flow block by block</p>
                <p className="max-w-md text-xs text-ink-soft">
                  Add an approval block when someone has to decide, an automation block when something should
                  happen, and chain them in whatever order the process needs.
                </p>
                {paletteAt === 0 ? (
                  <Palette onPick={(t) => insertAt(0, t)} onClose={() => setPaletteAt(null)} />
                ) : (
                  !ro && (
                    <button type="button" onClick={() => setPaletteAt(0)} className="btn-primary">
                      <Icon name="add" className="text-[18px]" /> Add your first block
                    </button>
                  )
                )}
              </div>
            )}

            {blocks.map((b, i) => {
              const isApproval = b.type === "APPROVAL";
              const meta = isApproval
                ? { icon: "verified_user", label: "Approval", ring: "border-surface-border", text: "text-primary-dark" }
                : ACTION_META[b.actionKind];
              const stepIssues = issues.filter((x) => x.key === b.key).length;
              const approvalIdx = isApproval ? approvals.findIndex((a) => a.key === b.key) : -1;
              return (
                <div key={b.key}>
                  <div
                    onDragOver={(e) => {
                      if (ro) return;
                      e.preventDefault();
                      setDragOver(i);
                    }}
                    onDrop={() => !ro && onDrop(i)}
                    className={`card overflow-hidden ${dragOver === i ? "ring-2 ring-primary/40" : ""} ${
                      stepIssues > 0 ? "border-amber-300" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <button
                        type="button"
                        draggable={!ro}
                        disabled={ro}
                        onDragStart={() => setDragKey(b.key)}
                        onDragEnd={() => {
                          setDragKey(null);
                          setDragOver(null);
                        }}
                        onClick={() => patchBlock(b.key, { open: !b.open })}
                        title="Drag to reorder · click to open"
                        className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-full bg-surface-muted"
                      >
                        <Icon
                          name={meta.icon}
                          className={`text-[16px] ${
                            stepIssues > 0 ? "text-amber-600" : !b.enabled ? "text-ink-faint" : isApproval ? "text-primary-dark" : meta.text
                          }`}
                        />
                      </button>
                      <input
                        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-ink outline-none hover:border-surface-border focus:border-primary focus:bg-white"
                        value={b.name}
                        disabled={ro}
                        placeholder={isApproval ? "Approval block name" : "Automation label (optional)"}
                        onChange={(e) => patchBlock(b.key, { name: e.target.value })}
                      />
                      <span className="hidden shrink-0 text-[11px] text-ink-soft sm:block">
                        {isApproval ? (
                          <>
                            <span className="badge mr-1 bg-surface-muted">
                              approval {approvalIdx + 1} · {APPROVER_TYPES.find((t) => t.value === b.approverType)?.label ?? b.approverType}
                            </span>
                            {b.approvalMode === "ALL" && <span className="badge bg-indigo-50 text-indigo-700">all must approve</span>}
                          </>
                        ) : (
                          <>
                            <span className={`badge mr-1 ${meta.ring} bg-white`}>{meta.label}</span>
                            <span className="text-ink-faint">{whenSummary(b, blocks)}</span>
                          </>
                        )}
                      </span>
                      {!b.enabled && <span className="badge shrink-0 bg-gray-100 text-ink-faint">off</span>}
                      {stepIssues > 0 && (
                        <span className="badge shrink-0 bg-amber-100 text-amber-800" title="Needs attention">
                          {stepIssues}
                        </span>
                      )}
                      <div className="flex shrink-0 items-center">
                        <button type="button" className="icon-btn !h-7 !w-7" title="Move up" onClick={() => moveBlock(b.key, -1)}>
                          <Icon name="keyboard_arrow_up" className="text-[18px]" />
                        </button>
                        <button type="button" className="icon-btn !h-7 !w-7" title="Move down" onClick={() => moveBlock(b.key, 1)}>
                          <Icon name="keyboard_arrow_down" className="text-[18px]" />
                        </button>
                        <button
                          type="button"
                          className="icon-btn !h-7 !w-7"
                          title={b.open ? "Collapse" : "Open"}
                          onClick={() => patchBlock(b.key, { open: !b.open })}
                        >
                          <Icon name={b.open ? "expand_less" : "expand_more"} className="text-[18px]" />
                        </button>
                      </div>
                    </div>

                    {b.open && (
                      <div className="border-t border-surface-border/70">
                        {isApproval ? (
                          <>
                            <div className="px-4 py-3">
                              <label className="label">Who decides</label>
                              <div className="flex flex-wrap items-center gap-2">
                                <Segmented
                                  disabled={ro}
                                  value={b.approverType}
                                  onChange={(v) => patchBlock(b.key, { approverType: v })}
                                  options={APPROVER_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                                />
                                {(b.approverType === "USER" || b.approverType === "GROUP" || b.approverType === "ROLE") && (
                                  <select
                                    className="input !w-56 !py-1.5 text-xs"
                                    disabled={ro}
                                    value={b.approverType === "USER" ? b.targetUserId : b.approverType === "GROUP" ? b.targetGroupId : b.targetRoleId}
                                    onChange={(e) =>
                                      patchBlock(
                                        b.key,
                                        b.approverType === "USER"
                                          ? { targetUserId: e.target.value }
                                          : b.approverType === "GROUP"
                                            ? { targetGroupId: e.target.value }
                                            : { targetRoleId: e.target.value }
                                      )
                                    }
                                  >
                                    <option value="">— choose —</option>
                                    {b.approverType === "USER" &&
                                      users.map((u) => (
                                        <option key={u.UserID} value={u.UserID}>
                                          {u.Name} · {u.Email}
                                        </option>
                                      ))}
                                    {b.approverType === "GROUP" &&
                                      groups.map((g) => (
                                        <option key={g.id} value={g.id}>
                                          {g.name}
                                        </option>
                                      ))}
                                    {b.approverType === "ROLE" &&
                                      roles.map((r) => (
                                        <option key={r.id} value={r.id}>
                                          {r.name}
                                        </option>
                                      ))}
                                  </select>
                                )}
                              </div>
                              <p className="mt-1 text-[11px] text-ink-faint">
                                {APPROVER_TYPES.find((t) => t.value === b.approverType)?.hint}
                              </p>
                            </div>

                            <div className="grid gap-3 border-t border-surface-border/70 px-4 py-3 sm:grid-cols-4">
                              <Field label="Quorum">
                                <Segmented
                                  disabled={ro}
                                  value={b.approvalMode}
                                  onChange={(v) => patchBlock(b.key, { approvalMode: v })}
                                  options={QUORUMS}
                                />
                              </Field>
                              <Field label="Comments">
                                <select
                                  className="input !py-1.5 text-xs"
                                  disabled={ro}
                                  value={b.commentPolicy}
                                  onChange={(e) => patchBlock(b.key, { commentPolicy: e.target.value })}
                                >
                                  {COMMENT_POLICIES.map((c) => (
                                    <option key={c.value} value={c.value}>
                                      {c.label}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="Due (days)">
                                <input
                                  className="input !py-1.5 text-xs"
                                  disabled={ro}
                                  inputMode="numeric"
                                  placeholder="none"
                                  value={b.dueDays}
                                  onChange={(e) => patchBlock(b.key, { dueDays: e.target.value })}
                                />
                              </Field>
                              <Field label="On reject">
                                <select
                                  className="input !py-1.5 text-xs"
                                  disabled={ro}
                                  value={b.rejectAction}
                                  onChange={(e) => patchBlock(b.key, { rejectAction: e.target.value })}
                                >
                                  {REJECT_ACTIONS.map((r) => (
                                    <option key={r.value} value={r.value}>
                                      {r.label}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                            </div>

                            <div className="grid gap-3 border-t border-surface-border/70 px-4 py-3 sm:grid-cols-2">
                              <Field label="On approve">
                                <select
                                  className="input !py-1.5 text-xs"
                                  disabled={ro}
                                  value={b.approveAction}
                                  onChange={(e) => patchBlock(b.key, { approveAction: e.target.value })}
                                >
                                  {APPROVE_ACTIONS.map((a) => (
                                    <option key={a.value} value={a.value}>
                                      {a.label}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              {b.approveAction === "JUMP_TO_STEP" && (
                                <Field label="Jump to block">
                                  <select
                                    className="input !py-1.5 text-xs"
                                    disabled={ro}
                                    value={b.approveTargetKey}
                                    onChange={(e) => patchBlock(b.key, { approveTargetKey: e.target.value })}
                                  >
                                    <option value="">— choose —</option>
                                    {approvals.map((a, ai) => (
                                      <option key={a.key} value={a.key} disabled={a.key === b.key}>
                                        {ai + 1}. {a.name || "Untitled"}
                                      </option>
                                    ))}
                                  </select>
                                </Field>
                              )}
                            </div>
                          </>
                        ) : (
                          <div className="space-y-3 px-4 py-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field label="This block does">
                                <select
                                  className="input !py-1.5 text-xs"
                                  disabled={ro}
                                  value={b.actionKind}
                                  onChange={(e) => patchBlock(b.key, { actionKind: e.target.value as ActionKind })}
                                >
                                  {RULE_ACTIONS.map((a) => (
                                    <option key={a.value} value={a.value}>
                                      {a.label}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="Runs after">
                                <select
                                  className="input !py-1.5 text-xs"
                                  disabled={ro}
                                  value={b.scope}
                                  onChange={(e) => patchBlock(b.key, { scope: e.target.value as RunScope })}
                                >
                                  {(Object.keys(SCOPE_LABELS) as RunScope[]).map((s) => (
                                    <option key={s} value={s}>
                                      {SCOPE_LABELS[s]}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                            </div>

                            {(b.scope === "AFTER_STEP" || b.scope === "ANY_STEP") && (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">On decision</span>
                                <Segmented
                                  disabled={ro}
                                  value={b.decision}
                                  onChange={(v) => patchBlock(b.key, { decision: v as Decision })}
                                  options={[
                                    { value: "APPROVED", label: "Approve" },
                                    { value: "REJECTED", label: "Reject" },
                                    { value: "BOTH", label: "Both" },
                                  ]}
                                />
                              </div>
                            )}

                            {b.scope === "AFTER_STEP" && (
                              <p className="text-[11px] text-ink-faint">
                                {boundApprovalIndex(blocks, i) < 0 ? (
                                  <span className="text-danger">
                                    Nothing to attach to — drag this block below an approval block, or pick another
                                    “runs after”.
                                  </span>
                                ) : (
                                  <>
                                    Attached to “{approvalNameAt(blocks, boundApprovalIndex(blocks, i))}”. Move this
                                    block between approvals to re-target it.
                                  </>
                                )}
                              </p>
                            )}

                            {b.actionKind === "SET_PRIORITY" && (
                              <Segmented
                                disabled={ro}
                                value={b.priority}
                                onChange={(v) => patchBlock(b.key, { priority: v })}
                                options={PRIORITY_VALUES.map((p) => ({ value: p, label: p }))}
                              />
                            )}

                            {b.actionKind === "SET_SLA" && (
                              <Field label="SLA policy">
                                <select
                                  className="input !py-1.5 text-xs"
                                  disabled={ro}
                                  value={b.slaPolicyId}
                                  onChange={(e) => patchBlock(b.key, { slaPolicyId: e.target.value })}
                                >
                                  <option value="">— choose a policy —</option>
                                  {slas.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}
                                      {s.isDefault ? " (default)" : ""}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                            )}

                            {b.actionKind === "ASSIGN_TO_USER" && (
                              <Field label="Assign to">
                                <select className="input !py-1.5 text-xs" disabled={ro} value={b.userId} onChange={(e) => patchBlock(b.key, { userId: e.target.value })}>
                                  <option value="">— choose a user —</option>
                                  {users.map((u) => (
                                    <option key={u.UserID} value={u.UserID}>
                                      {u.Name} · {u.Email}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                            )}

                            {b.actionKind === "NOTIFY" && (
                              <div className="grid gap-3 sm:grid-cols-2">
                                <Field label="Who">
                                  <select
                                    className="input !py-1.5 text-xs"
                                    disabled={ro}
                                    value={b.notifyTargetType}
                                    onChange={(e) => patchBlock(b.key, { notifyTargetType: e.target.value })}
                                  >
                                    <option value="REQUESTER">The requester</option>
                                    <option value="DEPARTMENT_MANAGER">Requester&apos;s department manager</option>
                                    <option value="USER">A specific user</option>
                                    <option value="GROUP">All members of a group</option>
                                    <option value="ROLE">All users with a role</option>
                                  </select>
                                </Field>
                                {b.notifyTargetType === "USER" && (
                                  <Field label="User">
                                    <select className="input !py-1.5 text-xs" disabled={ro} value={b.notifyUserId} onChange={(e) => patchBlock(b.key, { notifyUserId: e.target.value })}>
                                      <option value="">— choose —</option>
                                      {users.map((u) => (
                                        <option key={u.UserID} value={u.UserID}>
                                          {u.Name}
                                        </option>
                                      ))}
                                    </select>
                                  </Field>
                                )}
                                {b.notifyTargetType === "GROUP" && (
                                  <Field label="Group">
                                    <select className="input !py-1.5 text-xs" disabled={ro} value={b.notifyGroupId} onChange={(e) => patchBlock(b.key, { notifyGroupId: e.target.value })}>
                                      <option value="">— choose —</option>
                                      {groups.map((g) => (
                                        <option key={g.id} value={g.id}>
                                          {g.name}
                                        </option>
                                      ))}
                                    </select>
                                  </Field>
                                )}
                                {b.notifyTargetType === "ROLE" && (
                                  <Field label="Role">
                                    <select className="input !py-1.5 text-xs" disabled={ro} value={b.notifyRoleId} onChange={(e) => patchBlock(b.key, { notifyRoleId: e.target.value })}>
                                      <option value="">— choose —</option>
                                      {roles.map((r) => (
                                        <option key={r.id} value={r.id}>
                                          {r.name}
                                        </option>
                                      ))}
                                    </select>
                                  </Field>
                                )}
                                <input
                                  className="input !py-1.5 text-xs"
                                  disabled={ro}
                                  placeholder="Title (optional)"
                                  value={b.notifyTitle}
                                  onChange={(e) => patchBlock(b.key, { notifyTitle: e.target.value })}
                                />
                                <input
                                  className="input !py-1.5 text-xs"
                                  disabled={ro}
                                  placeholder="Message (optional)"
                                  value={b.notifyMessage}
                                  onChange={(e) => patchBlock(b.key, { notifyMessage: e.target.value })}
                                />
                              </div>
                            )}

                            {b.actionKind === "JUMP_TO_STEP" && (
                              <Field label="Land on approval block">
                                <select className="input !py-1.5 text-xs" disabled={ro} value={b.jumpToStepKey} onChange={(e) => patchBlock(b.key, { jumpToStepKey: e.target.value })}>
                                  <option value="">— choose —</option>
                                  {approvals.map((a, ai) => (
                                    <option key={a.key} value={a.key}>
                                      {ai + 1}. {a.name || "Untitled"}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                            )}
                          </div>
                        )}

                        {/* shared: when it applies at all */}
                        <div className="flex flex-wrap items-center gap-2 border-t border-surface-border/70 px-4 py-3">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                            {isApproval ? "This block applies when" : "Only when"}
                          </span>
                          <ConditionRow
                            disabled={ro}
                            field={b.condField}
                            op={b.condOp}
                            value={b.condValue}
                            onChange={(p) => patchBlock(b.key, p)}
                          />
                          {condText(b) && (
                            <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] text-ink-soft">
                              {condText(b)}
                            </span>
                          )}
                        </div>

                        {!ro && (
                          <div className="flex items-center justify-end gap-3 border-t border-surface-border/70 px-3 py-2 text-[11px] font-medium">
                            {!isApproval && (
                              <button
                                type="button"
                                onClick={() => patchBlock(b.key, { enabled: !b.enabled })}
                                className="text-ink-soft hover:text-primary"
                              >
                                {b.enabled ? "Pause" : "Resume"}
                              </button>
                            )}
                            <button type="button" onClick={() => duplicateBlock(b.key)} className="text-ink-soft hover:text-primary">
                              Duplicate
                            </button>
                            <button type="button" onClick={() => removeBlock(b.key)} className="text-ink-soft hover:text-danger">
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* insertion point */}
                  {!ro && (
                    <div className="py-1">
                      {paletteAt === i + 1 ? (
                        <Palette onPick={(t) => insertAt(i + 1, t)} onClose={() => setPaletteAt(null)} />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPaletteAt(i + 1)}
                          className="mx-auto flex h-6 w-full max-w-xs items-center justify-center gap-1 rounded border border-dashed border-surface-border text-[11px] text-ink-faint hover:border-primary hover:text-primary"
                        >
                          <Icon name="add" className="text-[14px]" /> block after this
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {blocks.length > 0 &&
              (paletteAt === -1 ? (
                <Palette onPick={(t) => insertAt(0, t)} onClose={() => setPaletteAt(null)} />
              ) : (
                !ro && (
                  <button
                    type="button"
                    onClick={() => setPaletteAt(-1)}
                    className="mx-auto flex h-6 w-full max-w-xs items-center justify-center gap-1 rounded border border-dashed border-surface-border text-[11px] text-ink-faint hover:border-primary hover:text-primary"
                  >
                    <Icon name="add" className="text-[14px]" /> block before the first one
                  </button>
                )
              ))}
          </div>
        </div>

        {/* rail */}
        <div className="space-y-4 xl:col-span-4">
          <div className="card p-4">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-faint">Your flow</h3>
            {blocks.length === 0 ? (
              <p className="text-xs text-ink-faint">Empty — nothing runs yet.</p>
            ) : (
              <ol className="space-y-1">
                {blocks.map((b, i) => (
                  <li key={b.key}>
                    <button
                      type="button"
                      onClick={() => focus(b.key)}
                      className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-surface-muted"
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[9px] font-bold text-ink-soft">
                        {i + 1}
                      </span>
                      <Icon
                        name={b.type === "APPROVAL" ? "verified_user" : ACTION_META[b.actionKind].icon}
                        className={`text-[14px] ${b.type === "APPROVAL" ? "text-primary" : ACTION_META[b.actionKind].text} ${
                          b.enabled ? "" : "opacity-40"
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate text-ink">{b.name || (b.type === "APPROVAL" ? "Untitled approval" : "Untitled automation")}</span>
                      {b.condField !== "none" && <Icon name="if_while" className="text-[13px] text-ink-faint" />}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className={`card p-4 ${issues.length > 0 ? "border-amber-300" : ""}`}>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-faint">
              <Icon name={issues.length > 0 ? "fact_check" : "check_circle"} className="text-[15px]" />
              Readiness
            </h3>
            {issues.length === 0 ? (
              <p className="text-xs text-green-700">
                {approvals.length === 0
                  ? "No approval blocks: every request is approved the moment it is submitted. Fine for automations, intentional?"
                  : "Ready. Save to publish."}
              </p>
            ) : (
              <ul className="space-y-1">
                {issues.map((x, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => focus(x.key)}
                      className="flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left text-xs text-ink-soft hover:bg-amber-50"
                    >
                      <Icon name="error" className="mt-px shrink-0 text-[14px] text-amber-600" />
                      {x.text}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-4">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-faint">Used by forms</h3>
            {templates.length === 0 && <p className="text-xs text-ink-faint">No form templates yet.</p>}
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {templates.map((t) => (
                <label key={t.FormTemplateID} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-surface-muted">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5"
                    disabled={ro}
                    checked={assigned.has(t.FormTemplateID)}
                    onChange={() =>
                      setAssigned((prev) => {
                        const n = new Set(prev);
                        if (n.has(t.FormTemplateID)) n.delete(t.FormTemplateID);
                        else n.add(t.FormTemplateID);
                        return n;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate text-ink">{t.Name}</span>
                  <span className={`text-[10px] ${t.Status === "ACTIVE" ? "text-green-600" : "text-ink-faint"}`}>
                    {t.Status === "ACTIVE" ? "live" : t.Status.toLowerCase()}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="card p-4 text-[11px] leading-relaxed text-ink-faint">
            Blocks run in the order shown. Automation blocks attached to an approval block fire right after that
            decision is recorded; a Jump stops the rest of its group. Saving writes steps and automation rules in
            one transaction — no separate screens, no schema change.
          </div>
        </div>
      </div>

      {ro && <p className="mt-4 text-center text-xs text-ink-faint">Read-only view — you do not have workflow management.</p>}
    </AppShell>
  );
}
