"use client";

/**
 * Workflow editor — an n8n-style visual canvas.
 *
 *   left   node palette (drag a tool onto the canvas, or click to add)
 *   middle the React Flow canvas: drag, connect the coloured ports, select
 *   right  the config rail: settings for the selected node, plus readiness
 *
 * The canvas stores its own layout (positions + wiring) as `CanvasJson` on the
 * workflow, but the engine still runs on WFSteps / WFRules — `graphToApi`
 * derives those from the graph on every save, so the two can never drift.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import AppShell from "@/components/AppShell";
import { Icon, StatusBadge } from "@/components/ui";
import {
  CONDITION_FIELDS,
  NUMERIC_OPS,
  PRIORITY_OPS,
  PRIORITY_VALUES,
} from "@/lib/workflow-conditions";
import { NOTIFY_TARGET_TYPES } from "@/lib/workflow-rules";
import type { FlowNode, PresetAudience, ToolId } from "@/lib/workflow-builder";
import {
  apiToGraph,
  graphToApi,
  makeNode,
  validateGraph,
  walk,
  type GNodeKind,
  type Graph,
} from "@/lib/workflow-graph";
import { RECIPES, SETTABLE_STATUSES, TOOLS, statusMeta, toolMeta } from "@/lib/workflow-tools";
import WorkflowCanvas, { type WorkflowCanvasApi } from "@/components/workflow/WorkflowCanvas";
import type { DepRow, GroupRow, RoleRow, UserRow, WfLookups } from "@/components/workflow/WfNodeCards";

/* ------------------------------------------------------------- data shapes -- */

interface SlaRow {
  id: string;
  name: string;
  isDefault: boolean;
  targets?: { priority: string; responseMins: number; resolveMins: number }[];
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
  TargetDEPID?: string | null;
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
  OnDemand?: boolean;
  Steps: LoadedStep[];
  Rules?: LoadedRule[];
  CanvasJson?: string | null;
  usage?: { templates: number; liveRequests: number; decisions: number };
}

/* --------------------------------------------------------------- options -- */

const APPROVER_TYPES = [
  { value: "DEPARTMENT_MANAGER", label: "Dept manager" },
  { value: "REQUESTER_MANAGER", label: "Direct manager" },
  { value: "DEPARTMENT", label: "A dept's manager" },
  { value: "USER", label: "One person" },
  { value: "GROUP", label: "Group" },
  { value: "ROLE", label: "Role" },
  { value: "ANY_APPROVER", label: "Any approver" },
];

const PRESET_ICONS = [
  { name: "tune", label: "General Preset" },
  { name: "account_balance_wallet", label: "Budget & Finance" },
  { name: "payments", label: "Payment & Expense" },
  { name: "verified_user", label: "Approval & Sign-off" },
  { name: "support_agent", label: "IT & Support" },
  { name: "build", label: "Maintenance & Operations" },
  { name: "local_shipping", label: "Procurement & Shipping" },
  { name: "inventory_2", label: "Inventory & Assets" },
  { name: "security", label: "Security & Permissions" },
  { name: "bolt", label: "Fast Action" },
  { name: "assignment", label: "Task / Checklist" },
  { name: "send", label: "Escalate & Send" },
];

/* ---------------------------------------------------------------- palette -- */

interface PaletteItemSpec {
  kind: GNodeKind;
  tool: ToolId;
  label: string;
  icon: string;
  accent: string;
  blurb: string;
}

const ACTION_TOOLS: ToolId[] = TOOLS.filter((t) => t.kind === "action").map((t) => t.id);

const PALETTE_SECTIONS: { name: string; items: PaletteItemSpec[] }[] = (() => {
  const t = (id: ToolId): PaletteItemSpec => {
    const m = toolMeta(id)!;
    return { kind: "action", tool: id, label: m.label, icon: m.icon, accent: m.accent, blurb: m.blurb };
  };
  return [
    {
      name: "Trigger",
      items: [
        {
          kind: "start",
          tool: "START",
          label: "Request submitted",
          icon: "play_circle",
          accent: "bg-emerald-50 text-emerald-700 border-emerald-200",
          blurb: "the moment a request enters the queue",
        },
        {
          kind: "start",
          tool: "STATUS_TRIGGER",
          label: "Status changed",
          icon: "flag",
          accent: "bg-sky-50 text-sky-700 border-sky-200",
          blurb: "when ticket status changes",
        },
        {
          kind: "start",
          tool: "PRIORITY_TRIGGER",
          label: "Priority changed",
          icon: "priority_high",
          accent: "bg-rose-50 text-rose-700 border-rose-200",
          blurb: "when ticket priority is updated",
        },
        {
          kind: "start",
          tool: "APPROVAL_DECIDED",
          label: "Approval decided",
          icon: "verified",
          accent: "bg-purple-50 text-purple-700 border-purple-200",
          blurb: "when an approval is decided",
        },
      ],
    },
    {
      name: "People",
      items: [
        (() => {
          const m = toolMeta("APPROVAL")!;
          return { kind: "approval" as GNodeKind, tool: "APPROVAL" as ToolId, label: m.label, icon: m.icon, accent: m.accent, blurb: m.blurb };
        })(),
        ...ACTION_TOOLS.filter((id) => ["NOTIFY", "ASSIGN_TO_USER", "ASSIGN_TO_GROUP", "ASSIGN_TO_DEPARTMENT"].includes(id)).map(t),
      ],
    },
    {
      name: "Update the request",
      items: ACTION_TOOLS.filter((id) => ["SET_PRIORITY", "SET_STATUS", "SET_SLA"].includes(id)).map(t),
    },
    {
      name: "Flow control",
      items: ACTION_TOOLS.filter((id) => id === "JUMP_TO_STEP").map(t),
    },
  ];
})();

function Palette({
  ro,
  preset,
  onAdd,
  onRecipe,
}: {
  ro: boolean;
  preset: boolean;
  onAdd: (p: PaletteItemSpec) => void;
  onRecipe: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2">
        <Icon name="widgets" className="text-[18px] text-outline" />
        <h3 className="text-xs font-bold uppercase tracking-wider text-outline">Nodes</h3>
        <span className="ml-auto text-[10px] text-outline">drag or click</span>
      </div>
      <input
        id="wf-node-search"
        className="input mb-3 !py-1 text-xs"
        placeholder="Search nodes — /"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {PALETTE_SECTIONS.map((s) => {
          if (preset && s.name === "Trigger") return null;
          const items = needle ? s.items.filter((i) => (i.label + i.blurb).toLowerCase().includes(needle)) : s.items;
          if (items.length === 0) return null;
          return (
            <div key={s.name}>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-outline">{s.name}</div>
              <div className="space-y-1">
                {items.map((it) => {
                  const label = it.label;
                  const blurb = it.blurb;
                  return (
                  <button
                    key={it.tool + it.kind}
                    type="button"
                    disabled={ro}
                    draggable={!ro}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/x-wf-node", JSON.stringify({ kind: it.kind, tool: it.tool }));
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => onAdd(it)}
                    title={ro ? blurb : `${blurb}\n\nDrag it anywhere on the canvas, or click to add it at the end of the flow.`}
                    className="flex w-full cursor-grab items-start gap-2 rounded-lg border border-surface-variant bg-white p-1.5 text-left transition-colors hover:border-primary/50 hover:bg-surface-container-lowest active:cursor-grabbing"
                  >
                    <span className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded border ${it.accent}`}>
                      <Icon name={it.icon} className="text-[14px]" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-on-surface">{label}</span>
                      <span className="block truncate text-[10px] leading-snug text-outline">{blurb}</span>
                    </span>
                  </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="border-t border-surface-variant/70 pt-2">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-outline">Starters</div>
          {RECIPES.map((r) => (
            <button
              key={r.id}
              type="button"
              disabled={ro}
              onClick={() => onRecipe(r.id)}
              title={r.blurb}
              className="mb-1 flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-surface-container-low"
            >
              <Icon name={r.icon} className="mt-0.5 text-[15px] text-outline" />
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold text-on-surface">{r.label}</span>
                <span className="block text-[10px] leading-snug text-outline">spliced into the end of the flow</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- config -- */

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
          className={`rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ${
            value === o.value
              ? "border-primary bg-surface-container-low text-primary-dark"
              : "border-surface-variant bg-white text-on-surface-variant hover:bg-surface-container-low"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div className="label !mb-1 flex items-center gap-1.5">
        {label}
        {hint && (
          <span className="font-normal normal-case tracking-normal text-outline" title={hint}>
            <Icon name="help" className="text-[13px]" />
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function ConditionRow({ n, disabled, onPatch }: { n: FlowNode; disabled?: boolean; onPatch: (p: Partial<FlowNode>) => void }) {
  const isPriority = n.condField === "priority";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="input w-auto !py-1.5 text-xs"
        disabled={disabled}
        value={n.condField}
        onChange={(e) =>
          onPatch({
            condField: e.target.value,
            condOp: e.target.value === "priority" ? "in" : ">=",
            condValue: e.target.value === "none" ? "" : n.condValue,
          })
        }
      >
        {CONDITION_FIELDS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      {n.condField !== "none" && (
        <>
          <select className="input w-auto !py-1.5 text-xs" disabled={disabled} value={n.condOp} onChange={(e) => onPatch({ condOp: e.target.value })}>
            {(isPriority ? PRIORITY_OPS : NUMERIC_OPS).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {isPriority ? (
            <select className="input w-auto !py-1.5 text-xs" disabled={disabled} value={n.condValue} onChange={(e) => onPatch({ condValue: e.target.value })}>
              {PRIORITY_VALUES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value="HIGH,URGENT">HIGH or URGENT</option>
            </select>
          ) : (
            <input
              className="input !w-24 !py-1.5 text-xs"
              disabled={disabled}
              inputMode="numeric"
              placeholder="value"
              value={n.condValue}
              onChange={(e) => onPatch({ condValue: e.target.value })}
            />
          )}
        </>
      )}
    </div>
  );
}

/** per-tool settings for an action node (the canvas wiring replaces the old "runs when" picker) */
function ActionFields({
  n,
  lookups,
  ro,
  onPatch,
  jumpOptions,
}: {
  n: FlowNode;
  lookups: WfLookups;
  ro: boolean;
  onPatch: (p: Partial<FlowNode>) => void;
  jumpOptions: { id: string; label: string }[];
}) {
  return (
    <>
      {n.tool === "SET_PRIORITY" && (
        <Field label="Priority">
          <Segmented
            disabled={ro}
            value={n.priority}
            onChange={(v) => onPatch({ priority: v })}
            options={PRIORITY_VALUES.map((p) => ({ value: p, label: p }))}
          />
        </Field>
      )}

      {n.tool === "SET_STATUS" && (
        <Field label="New status">
          <select className="input !py-1.5 text-xs" disabled={ro} value={n.status} onChange={(e) => onPatch({ status: e.target.value })}>
            <option value="">— which status? —</option>
            {SETTABLE_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {n.status && statusMeta(n.status)?.note && <p className="mt-1 text-[10px] text-outline">{statusMeta(n.status)?.note}</p>}
        </Field>
      )}

      {n.tool === "SET_SLA" && (
        <Field label="Policy" hint="the target matching the request's current priority is applied">
          <select className="input !py-1.5 text-xs" disabled={ro} value={n.slaPolicyId} onChange={(e) => onPatch({ slaPolicyId: e.target.value })}>
            <option value="">— choose a policy —</option>
            {lookups.slas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {n.tool === "ASSIGN_TO_USER" && (
        <Field label="Assign to">
          <select className="input !py-1.5 text-xs" disabled={ro} value={n.userId} onChange={(e) => onPatch({ userId: e.target.value })}>
            <option value="">— whom? —</option>
            {lookups.users.map((u) => (
              <option key={u.UserID} value={u.UserID}>
                {u.Name} · {u.Email}
              </option>
            ))}
          </select>
        </Field>
      )}

      {n.tool === "ASSIGN_TO_GROUP" && (
        <Field label="Group">
          <select className="input !py-1.5 text-xs" disabled={ro} value={n.assignGroupId} onChange={(e) => onPatch({ assignGroupId: e.target.value })}>
            <option value="">— which group? —</option>
            {lookups.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-outline">lands on the first active member · the whole group is notified</p>
        </Field>
      )}

      {n.tool === "ASSIGN_TO_DEPARTMENT" && (
        <Field label="Department">
          <select
            className="input !py-1.5 text-xs"
            disabled={ro}
            value={n.assignDepId}
            onChange={(e) => onPatch({ assignDepId: e.target.value })}
          >
            <option value="">— which department? —</option>
            {lookups.deps.map((d) => (
              <option key={d.DEPID} value={d.DEPID}>
                {d.Name}
                {d.Code ? ` (${d.Code})` : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-outline">the department&apos;s manager becomes the assignee</p>
        </Field>
      )}

      {n.tool === "NOTIFY" && (
        <div className="grid gap-2.5">
          <Field label="Notify">
            <select
              className="input !py-1.5 text-xs"
              disabled={ro}
              value={n.notifyTargetType}
              onChange={(e) => onPatch({ notifyTargetType: e.target.value })}
            >
              <option value="">— who? —</option>
              {NOTIFY_TARGET_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          {n.notifyTargetType === "USER" && (
            <select className="input !py-1.5 text-xs" disabled={ro} value={n.notifyUserId} onChange={(e) => onPatch({ notifyUserId: e.target.value })}>
              <option value="">— which user? —</option>
              {lookups.users.map((u) => (
                <option key={u.UserID} value={u.UserID}>
                  {u.Name}
                </option>
              ))}
            </select>
          )}
          {n.notifyTargetType === "GROUP" && (
            <select className="input !py-1.5 text-xs" disabled={ro} value={n.notifyGroupId} onChange={(e) => onPatch({ notifyGroupId: e.target.value })}>
              <option value="">— which group? —</option>
              {lookups.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
          {n.notifyTargetType === "ROLE" && (
            <select className="input !py-1.5 text-xs" disabled={ro} value={n.notifyRoleId} onChange={(e) => onPatch({ notifyRoleId: e.target.value })}>
              <option value="">— which role? —</option>
              {lookups.roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
          <input className="input !py-1.5 text-xs" disabled={ro} placeholder="Title (optional)" value={n.notifyTitle} onChange={(e) => onPatch({ notifyTitle: e.target.value })} />
          <textarea
            className="input !py-1.5 text-xs"
            disabled={ro}
            rows={2}
            placeholder="Message (optional)"
            value={n.notifyMessage}
            onChange={(e) => onPatch({ notifyMessage: e.target.value })}
          />
        </div>
      )}

      {n.tool === "JUMP_TO_STEP" && (
        <Field label="Land on">
          <select className="input !py-1.5 text-xs" disabled={ro} value={n.jumpToStepKey} onChange={(e) => onPatch({ jumpToStepKey: e.target.value })}>
            <option value="">— which approval? —</option>
            {jumpOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
      )}
    </>
  );
}


/* --------------------------------------------------------------- the app -- */

const EMPTY_GRAPH: Graph = { nodes: [makeNode("start", "START", { x: 60, y: 140 })], edges: [] };

export default function WorkflowEditor({ workflowId }: { workflowId: string | null }) {
  const { user, token } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isNew = workflowId === null;
  const isPresetParam = isNew && (searchParams.get("preset") === "true" || searchParams.get("preset") === "1");
  const canManage = user?.role.code === "SUPER_ADMIN" || (user?.permissions?.includes("WF_MANAGE") ?? false);
  const ro = !canManage;

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [onDemand, setOnDemand] = useState(isPresetParam);
  const [presetIcon, setPresetIcon] = useState<string>("tune");
  const [presetAudience, setPresetAudience] = useState<PresetAudience>({ mode: "ALL", roleIds: [], depIds: [], groupIds: [] });
  const [graph, setGraph] = useState<Graph>(isPresetParam ? { nodes: [], edges: [] } : EMPTY_GRAPH);
  const [canvasKey, setCanvasKey] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [usage, setUsage] = useState<LoadedWorkflow["usage"] | null>(null);

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [deps, setDeps] = useState<DepRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [slas, setSlas] = useState<SlaRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [initialAssigned, setInitialAssigned] = useState<Set<string>>(new Set());

  const baseline = useRef("");
  const canvasApi = useRef<WorkflowCanvasApi | null>(null);

  const lookups: WfLookups = useMemo(() => ({ users, groups, roles, deps, slas }), [users, groups, roles, deps, slas]);

  const assignedDirty = useMemo(() => {
    if (assigned.size !== initialAssigned.size) return true;
    for (const id of Array.from(assigned)) {
      if (!initialAssigned.has(id)) return true;
    }
    return false;
  }, [assigned, initialAssigned]);

  const dirty = useMemo(
    () =>
      assignedDirty ||
      JSON.stringify({ name, description, status, onDemand, presetAudience, presetIcon, graph }) !== baseline.current,
    [assignedDirty, name, description, status, onDemand, presetAudience, presetIcon, graph]
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
    fetch("/api/departments", { headers: h })
      .then((r) => (r.ok ? r.json() : []))
      .then(
        (d: (DepRow & { Manager?: { Name: string } | null })[]) =>
          setDeps(Array.isArray(d) ? d.map((x) => ({ DEPID: x.DEPID, Name: x.Name, Code: x.Code })) : [])
      )
      .catch(() => setDeps([]));
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

  useEffect(() => {
    if (isNew || !token) return;
    setLoading(true);
    fetch(`/api/workflows/${workflowId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((w: LoadedWorkflow | null) => {
        if (!w) setError("Workflow not found");
        else {
          const g = apiToGraph(w.Steps || [], w.Rules || [], w.CanvasJson ?? null);
          setName(w.Name);
          setDescription(w.Description ?? "");
          setStatus(w.Status);
          setOnDemand(Boolean(w.OnDemand));
          if (g.presetAudience) setPresetAudience(g.presetAudience);
          if (g.presetIcon) setPresetIcon(g.presetIcon);
          setUsage(w.usage ?? null);
          setGraph(g);
          setCanvasKey((k) => k + 1);
          setSelectedIds([]);
          baseline.current = JSON.stringify({
            name: w.Name,
            description: w.Description ?? "",
            status: w.Status,
            onDemand: Boolean(w.OnDemand),
            presetAudience: g.presetAudience ?? { mode: "ALL", roleIds: [], depIds: [], groupIds: [] },
            presetIcon: g.presetIcon ?? "tune",
            graph: g,
          });
        }
      })
      .catch(() => setError("Failed to load workflow"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, workflowId, isNew]);

  /* ------------------------------------------------------------ selection -- */

  const selected = selectedIds[0] ?? null;
  const selectedNode = useMemo(() => graph.nodes.find((n) => n.id === selected) ?? null, [graph, selected]);


  /* -------------------------------------------------------------- helpers -- */

  const issues = useMemo(() => {
    const list = validateGraph(graph, { isPreset: onDemand });
    if (!name.trim()) list.unshift({ key: null, reason: "Give the workflow a name" });
    return list;
  }, [graph, name, onDemand]);

  const nodeTitle = useCallback((id: string) => {
    const n = graph.nodes.find((x) => x.id === id);
    if (!n) return "a deleted node";
    if (n.kind === "start") {
      const tool = n.data.tool;
      const meta = toolMeta(tool as ToolId);
      if (tool && tool !== "START") return meta?.label ?? "Trigger";
      return meta?.label ?? "Request submitted";
    }
    if (n.kind === "approval") return n.data.name || "Untitled approval";
    return toolMeta(n.data.tool as ToolId)?.label ?? "a node";
  }, [graph]);

  const wiringSummary = useCallback(
    (id: string) => {
      const ins = graph.edges.filter((e) => e.target === id);
      const outs = graph.edges.filter((e) => e.source === id);
      const insTxt =
        ins.length === 0
          ? "not connected to anything yet"
          : ins
              .map((e) => {
                const from = nodeTitle(e.source);
                const how = e.sourceHandle === "approve" ? "approved" : e.sourceHandle === "reject" ? "rejected" : "output";
                return `${from} · ${how}`;
              })
              .join(" · ");
      const outsTxt =
        outs.length === 0
          ? "nowhere to run to yet"
          : outs
              .map((e) => {
                const to = nodeTitle(e.target);
                const how = e.sourceHandle === "approve" ? "on approve" : e.sourceHandle === "reject" ? "on reject" : "then";
                return `${how} → ${to}`;
              })
              .join(" · ");
      return { insTxt, outsTxt };
    },
    [graph, nodeTitle]
  );

  /* ----------------------------------------------------------------- save -- */

  async function save() {
    setError("");
    if (!name.trim()) {
      setError("Give the workflow a name first.");
      return;
    }
    // save what is actually on screen — the canvas is the source of truth for
    // structure; the editor state follows it (it also self-corrects any drift)
    const live = canvasApi.current?.getGraph() ?? graph;
    const liveWithAudience: Graph = { ...live, presetAudience, presetIcon };
    const built = graphToApi(liveWithAudience, { slas, users, groups, departments: deps, isPreset: onDemand });
    if (built.problems.length > 0) {
      const p = built.problems[0];
      setError(p.key ? `“${p.reason}” — fix the highlighted node.` : p.reason);
      if (p.key) setSelectedIds([p.key]);
      return;
    }
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      status,
      onDemand,
      steps: built.steps,
      rules: built.rules,
      canvasJson: built.canvasJson,
    };
    setSaving(true);
    try {
      const res = await fetch(isNew ? "/api/workflows" : `/api/workflows/${workflowId}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({} as { error?: string; WFDefinitionID?: string; Steps?: { WFStepID: string; StepOrder?: number }[] }));
      if (!res.ok) {
        setError(d.error || "Save failed");
        return;
      }
      const savedId = isNew ? d.WFDefinitionID : workflowId;
      // Remember the saved WFStepIDs on the approval nodes (execution order ↔
      // StepOrder) so the NEXT save updates steps in place instead of trying
      // to recreate + delete them (blocked once a step has approval decisions).
      const savedSteps = Array.isArray(d.Steps) ? [...d.Steps].sort((a, b) => (a.StepOrder ?? 0) - (b.StepOrder ?? 0)) : [];
      let savedGraph = live;
      if (savedSteps.length > 0) {
        const idByNodeId = new Map<string, string>();
        walk(live)
          .order.filter((n) => n.kind === "approval")
          .forEach((n, i) => {
            const s = savedSteps[i];
            if (s && s.WFStepID) idByNodeId.set(n.id, s.WFStepID);
          });
        if (idByNodeId.size > 0) {
          savedGraph = {
            ...live,
            nodes: live.nodes.map((n) => (idByNodeId.has(n.id) ? { ...n, data: { ...n.data, id: idByNodeId.get(n.id) } } : n)),
          };
          setGraph(savedGraph); // the canvas resyncs to it (keeps its selection)
        }
      }
      if (!onDemand) {
        const h = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
        for (const tid of Array.from(assigned)) {
          if (!initialAssigned.has(tid) && savedId)
            await fetch(`/api/form-templates/${tid}`, { method: "PATCH", headers: h, body: JSON.stringify({ wfDefinitionId: savedId }) });
        }
        for (const tid of Array.from(initialAssigned)) {
          if (!assigned.has(tid))
            await fetch(`/api/form-templates/${tid}`, { method: "PATCH", headers: h, body: JSON.stringify({ wfDefinitionId: null }) });
        }
      }
      baseline.current = JSON.stringify({ name, description, status, onDemand, presetAudience, presetIcon, graph: savedGraph });
      setInitialAssigned(new Set(assigned));
      setSavedAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
      if (isNew && savedId) router.replace(onDemand ? "/automation-presets" : `/workflows/${savedId}`);
      else router.refresh();
    } catch {
      setError("Save failed — check your connection");
    } finally {
      setSaving(false);
    }
  }

  /* ------------------------------------------------------------ shortcuts -- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName ?? "";
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(tag);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!ro && dirty) void save();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) canvasApi.current?.redo();
        else canvasApi.current?.undo();
        return;
      }
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        document.getElementById("wf-node-search")?.focus();
        return;
      }
      if (e.key === "Escape") setSelectedIds([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ro, dirty, graph, name, description, status]);

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

  if (!canManage)
    return (
      <AppShell>
        <div className="card mx-auto mt-10 max-w-md p-6 text-center text-sm text-on-surface-variant">
          You need the workflow management permission to open this screen.
        </div>
      </AppShell>
    );

  if (loading)
    return (
      <AppShell>
        <div className="py-16 text-center text-sm text-on-surface-variant">Loading workflow…</div>
      </AppShell>
    );

  const approvalCount = graph.nodes.filter((n) => n.kind === "approval").length;
  const actionCount = graph.nodes.filter((n) => n.kind === "action").length;
  const patchSelected = (p: Partial<FlowNode>) => {
    if (selected) canvasApi.current?.patchNode(selected, p);
  };

  return (
    <AppShell>
      <div className="flex h-[calc(100dvh-148px)] min-h-[560px] flex-col overflow-hidden rounded-xl border border-surface-variant bg-white shadow-tier1">
        {/* header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-surface-variant px-3 py-2">
          <Link
            href={onDemand ? "/automation-presets" : "/workflows"}
            className="icon-btn !h-8 !w-8 shrink-0"
            title={onDemand ? "Back to Automation Presets" : "Back to workflows"}
          >
            <Icon name="arrow_back" className="text-[19px]" />
          </Link>
          <input
            className="min-w-0 flex-1 border-b border-transparent bg-transparent text-lg font-bold tracking-tight text-on-surface outline-none hover:border-surface-variant focus:border-primary"
            value={name}
            disabled={ro}
            placeholder={onDemand ? "Untitled Automation Preset" : "Untitled workflow"}
            onChange={(e) => setName(e.target.value)}
          />
          <StatusBadge status={status} />
          {onDemand && (
            <span className="badge border border-primary/25 bg-primary/10 text-[10px] font-bold text-primary">
              Automation Preset
            </span>
          )}
          <div className="hidden items-center gap-2 text-[11px] text-outline md:flex">
            <span>{approvalCount} approvals</span>
            <span>·</span>
            <span>{actionCount} actions</span>
            {usage && (
              <>
                <span>·</span>
                <span>
                  {usage.templates} form(s) · {usage.liveRequests} live
                </span>
              </>
            )}
          </div>
          <select className="input w-auto !py-1 text-[11px]" disabled={ro} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="ACTIVE">Active</option>
            <option value="DRAFT">Draft</option>
          </select>
          {savedAt && !dirty && <span className="hidden text-[11px] text-outline lg:block">saved {savedAt}</span>}
          {dirty && <span className="badge bg-amber-100 text-on-secondary-fixed-variant">unsaved</span>}
          <button onClick={() => void save()} disabled={saving || ro || (!dirty && !isNew)} className="btn-primary !px-3 !py-1.5 text-xs">
            <Icon name="save" className="text-[16px]" />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>

        {error && (
          <div className="flex shrink-0 items-start gap-2 border-b border-error/25 bg-error-container/60 px-4 py-1.5 text-sm text-danger">
            <Icon name="error" className="mt-0.5 text-[17px]" />
            <span>{error}</span>
          </div>
        )}

        {/* body */}
        <div className="flex min-h-0 flex-1">
          {/* palette */}
          <aside className="hidden w-60 shrink-0 border-r border-surface-variant bg-surface-container-low/40 p-3 lg:block">
            <Palette
              ro={ro}
              preset={onDemand}
              onAdd={(p) => canvasApi.current?.addNodeAtCenter(p.kind, p.tool)}
              onRecipe={(id) => canvasApi.current?.appendRecipe(id)}
            />
          </aside>

          {/* canvas */}
          <div className="relative min-w-0 flex-1">
            <WorkflowCanvas
              key={canvasKey}
              initial={graph}
              ro={ro}
              lookups={lookups}
              preset={onDemand}
              templateCount={usage?.templates ?? 0}
              onGraph={setGraph}
              onSelection={setSelectedIds}
              apiRef={canvasApi}
            />
          </div>

          {/* rail */}
          <aside className="hidden w-80 shrink-0 space-y-3 overflow-y-auto border-l border-surface-variant bg-surface-container-low/40 p-3 xl:block">
            {onDemand && (
              <div className="card !rounded-xl border border-primary/40 bg-white p-3.5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                      <Icon name={presetIcon || "tune"} className="text-[19px]" />
                    </span>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-primary">Automation Preset Settings</div>
                      <div className="text-xs font-semibold text-on-surface">Ticket On-Demand Action</div>
                    </div>
                  </div>
                  <span className="badge bg-primary/10 text-[10px] font-bold text-primary">Preset</span>
                </div>

                {/* Preset Icon Selector */}
                <Field label="Preset Icon in Ticket" hint="Choose an icon to identify this preset in tickets">
                  <div className="grid grid-cols-6 gap-1 pt-1">
                    {PRESET_ICONS.map((ic) => (
                      <button
                        key={ic.name}
                        type="button"
                        disabled={ro}
                        title={ic.label}
                        onClick={() => setPresetIcon(ic.name)}
                        className={`flex h-8 w-8 items-center justify-center rounded-lg border text-base transition-all ${
                          (presetIcon || "tune") === ic.name
                            ? "border-primary bg-primary text-white shadow-sm ring-2 ring-primary/20"
                            : "border-surface-variant bg-surface-container-lowest text-on-surface-variant hover:border-primary/40 hover:bg-surface-container-low"
                        }`}
                      >
                        <Icon name={ic.name} className="text-[17px]" />
                      </button>
                    ))}
                  </div>
                </Field>

                {/* Preset Audience */}
                <div className="border-t border-surface-variant/60 pt-2.5 space-y-2">
                  <Field label="Who can see & run this Preset in tickets">
                    <Segmented
                      disabled={ro}
                      value={presetAudience.mode}
                      onChange={(m) => setPresetAudience((prev) => ({ ...prev, mode: m as PresetAudience["mode"] }))}
                      options={[
                        { value: "ALL", label: "Everyone" },
                        { value: "ROLES", label: "Roles" },
                        { value: "DEPARTMENTS", label: "Depts" },
                        { value: "GROUPS", label: "Groups" },
                      ]}
                    />
                  </Field>

                  {presetAudience.mode === "ROLES" && (
                    <div className="space-y-1.5 rounded-lg border border-surface-variant bg-surface-container-lowest p-2">
                      <span className="block text-[11px] font-medium text-on-surface-variant">
                        Select roles allowed to run this preset:
                      </span>
                      <div className="max-h-36 space-y-1 overflow-y-auto">
                        {roles.map((r) => {
                          const checked = presetAudience.roleIds.includes(r.id);
                          return (
                            <label key={r.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 text-xs text-on-surface hover:bg-surface-container-low">
                              <input
                                type="checkbox"
                                disabled={ro}
                                checked={checked}
                                onChange={(e) => {
                                  setPresetAudience((prev) => ({
                                    ...prev,
                                    roleIds: e.target.checked
                                      ? [...prev.roleIds, r.id]
                                      : prev.roleIds.filter((id) => id !== r.id),
                                  }));
                                }}
                                className="h-3.5 w-3.5 rounded accent-primary"
                              />
                              <span>{r.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {presetAudience.mode === "DEPARTMENTS" && (
                    <div className="space-y-1.5 rounded-lg border border-surface-variant bg-surface-container-lowest p-2">
                      <span className="block text-[11px] font-medium text-on-surface-variant">
                        Select departments allowed to run this preset:
                      </span>
                      <div className="max-h-36 space-y-1 overflow-y-auto">
                        {deps.map((d) => {
                          const checked = presetAudience.depIds.includes(d.DEPID);
                          return (
                            <label key={d.DEPID} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 text-xs text-on-surface hover:bg-surface-container-low">
                              <input
                                type="checkbox"
                                disabled={ro}
                                checked={checked}
                                onChange={(e) => {
                                  setPresetAudience((prev) => ({
                                    ...prev,
                                    depIds: e.target.checked
                                      ? [...prev.depIds, d.DEPID]
                                      : prev.depIds.filter((id) => id !== d.DEPID),
                                  }));
                                }}
                                className="h-3.5 w-3.5 rounded accent-primary"
                              />
                              <span>{d.Name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {presetAudience.mode === "GROUPS" && (
                    <div className="space-y-1.5 rounded-lg border border-surface-variant bg-surface-container-lowest p-2">
                      <span className="block text-[11px] font-medium text-on-surface-variant">
                        Select groups allowed to run this preset:
                      </span>
                      <div className="max-h-36 space-y-1 overflow-y-auto">
                        {groups.map((g) => {
                          const checked = presetAudience.groupIds.includes(g.id);
                          return (
                            <label key={g.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 text-xs text-on-surface hover:bg-surface-container-low">
                              <input
                                type="checkbox"
                                disabled={ro}
                                checked={checked}
                                onChange={(e) => {
                                  setPresetAudience((prev) => ({
                                    ...prev,
                                    groupIds: e.target.checked
                                      ? [...prev.groupIds, g.id]
                                      : prev.groupIds.filter((id) => id !== g.id),
                                  }));
                                }}
                                className="h-3.5 w-3.5 rounded accent-primary"
                              />
                              <span>{g.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {selectedNode ? (
              <div className="card !rounded-lg p-3">
                <div className="mb-2.5 flex items-center gap-2">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-lg border ${
                      selectedNode.kind === "start"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : selectedNode.kind === "approval"
                          ? "border-surface-variant bg-surface-container-low text-primary-dark"
                          : toolMeta(selectedNode.data.tool as ToolId)?.accent ?? "border-surface-variant bg-surface-container-low"
                    }`}
                  >
                    <Icon
                      name={
                        selectedNode.kind === "start"
                          ? "play_circle"
                          : selectedNode.kind === "approval"
                            ? "verified_user"
                            : toolMeta(selectedNode.data.tool as ToolId)?.icon ?? "bolt"
                      }
                      className="text-[16px]"
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-outline">
                      {selectedNode.kind === "start"
                        ? "Trigger"
                        : selectedNode.kind === "approval"
                          ? "Approval"
                          : toolMeta(selectedNode.data.tool as ToolId)?.label ?? "Action"}
                    </div>
                    <div className="truncate text-sm font-semibold text-on-surface">{nodeTitle(selectedNode.id)}</div>
                  </div>
                  {!ro && (
                    <button
                      type="button"
                      className="icon-btn !h-7 !w-7"
                      title="Delete node"
                      onClick={() => {
                        canvasApi.current?.removeNode(selectedNode.id);
                        setSelectedIds([]);
                      }}
                    >
                      <Icon name="delete" className="text-[17px]" />
                    </button>
                  )}
                </div>

                {selectedNode.kind === "start" && (
                  <div className="space-y-3">
                    <Field label="Trigger Event">
                      <select
                        className="input !py-1.5 text-xs"
                        disabled={ro}
                        value={selectedNode.data.tool || "START"}
                        onChange={(e) => {
                          const newTool = e.target.value as ToolId;
                          patchSelected({ tool: newTool });
                        }}
                      >
                        <option value="START">Request submitted (When created)</option>
                        <option value="STATUS_TRIGGER">Status changed</option>
                        <option value="PRIORITY_TRIGGER">Priority changed</option>
                        <option value="APPROVAL_DECIDED">Approval decided</option>
                      </select>
                    </Field>

                    <p className="text-xs leading-relaxed text-on-surface-variant">
                      {selectedNode.data.tool === "STATUS_TRIGGER" ? (
                        <>
                          This automation fires automatically when the ticket status changes. Nodes wired to this
                          trigger execute upon status update.
                        </>
                      ) : selectedNode.data.tool === "PRIORITY_TRIGGER" ? (
                        <>
                          This automation fires automatically when the ticket priority is changed (e.g. upgraded to Urgent).
                        </>
                      ) : selectedNode.data.tool === "APPROVAL_DECIDED" ? (
                        <>
                          This automation fires whenever an approval step in the ticket reaches a decision.
                        </>
                      ) : (
                        <>
                          Everything wired to this node&apos;s port runs the moment the request is submitted — before
                          anybody approves anything.
                        </>
                      )}
                    </p>
                  </div>
                )}

                {selectedNode.kind === "approval" && (
                  <div className="space-y-3">
                    <Field label="Name">
                      <input
                        className="input !py-1.5 text-xs"
                        disabled={ro}
                        placeholder="e.g. Finance sign-off"
                        value={selectedNode.data.name}
                        onChange={(e) => patchSelected({ name: e.target.value })}
                      />
                    </Field>
                    <Field label="Who decides">
                      <div className="space-y-1.5">
                        <Segmented
                          disabled={ro}
                          value={selectedNode.data.approverType}
                          onChange={(v) => patchSelected({ approverType: v })}
                          options={APPROVER_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                        />
                        {(selectedNode.data.approverType === "USER" ||
                          selectedNode.data.approverType === "GROUP" ||
                          selectedNode.data.approverType === "ROLE" ||
                          selectedNode.data.approverType === "DEPARTMENT") && (
                          <select
                            className="input !py-1.5 text-xs"
                            disabled={ro}
                            value={
                              selectedNode.data.approverType === "USER"
                                ? selectedNode.data.targetUserId
                                : selectedNode.data.approverType === "GROUP"
                                  ? selectedNode.data.targetGroupId
                                  : selectedNode.data.approverType === "ROLE"
                                    ? selectedNode.data.targetRoleId
                                    : selectedNode.data.targetDepId
                            }
                            onChange={(e) =>
                              patchSelected(
                                selectedNode.data.approverType === "USER"
                                  ? { targetUserId: e.target.value }
                                  : selectedNode.data.approverType === "GROUP"
                                    ? { targetGroupId: e.target.value }
                                    : selectedNode.data.approverType === "ROLE"
                                      ? { targetRoleId: e.target.value }
                                      : { targetDepId: e.target.value }
                              )
                            }
                          >
                            <option value="">— choose —</option>
                            {selectedNode.data.approverType === "USER" &&
                              users.map((u) => (
                                <option key={u.UserID} value={u.UserID}>
                                  {u.Name} · {u.Email}
                                </option>
                              ))}
                            {selectedNode.data.approverType === "GROUP" &&
                              groups.map((g) => (
                                <option key={g.id} value={g.id}>
                                  {g.name}
                                </option>
                              ))}
                            {selectedNode.data.approverType === "ROLE" &&
                              roles.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                            {selectedNode.data.approverType === "DEPARTMENT" &&
                              deps.map((d) => (
                                <option key={d.DEPID} value={d.DEPID}>
                                  {d.Name} ({d.Code})
                                </option>
                              ))}
                          </select>
                        )}
                        {!selectedNode.data.approverType && (
                          <span className="text-[11px] font-medium text-amber-700">pick who decides — nothing is selected</span>
                        )}
                      </div>
                    </Field>
                    <Field label="Deadline (days)" hint="how long the approver has to decide — shown as this step's SLA, e.g. on request-approval runs. Leave empty for no deadline.">
                      <input
                        className="input !py-1.5 text-xs"
                        type="number"
                        min={1}
                        max={365}
                        disabled={ro}
                        placeholder="no deadline"
                        value={selectedNode.data.dueDays}
                        onChange={(e) => patchSelected({ dueDays: e.target.value })}
                      />
                    </Field>
                    <Field label="Only if" hint="the whole node is skipped when this is false">
                      <ConditionRow n={selectedNode.data} disabled={ro} onPatch={patchSelected} />
                    </Field>
                    <p className="text-[10px] leading-relaxed text-outline">
                      Wire the <span className="font-semibold text-[#15803d]">approved</span> port to what happens next,
                      and the <span className="font-semibold text-[#b42318]">rejected</span> port to the reject path.
                      A branch may simply end — when the last step approves the request becomes approved, when it
                      rejects the request becomes rejected (a plain status, no extra node).
                    </p>
                  </div>
                )}

                {selectedNode.kind === "action" && (
                  <div className="space-y-3">
                    <ActionFields
                      n={selectedNode.data}
                      lookups={lookups}
                      ro={ro}
                      onPatch={patchSelected}
                      jumpOptions={graph.nodes
                        .filter((x) => x.kind === "approval")
                        .map((x, i) => ({ id: x.id, label: `${i + 1}. ${x.data.name || "Untitled approval"}` }))}
                    />
                    <Field label="Only if" hint="the action is skipped when this is false">
                      <ConditionRow n={selectedNode.data} disabled={ro} onPatch={patchSelected} />
                    </Field>
                  </div>
                )}

                {/* wiring summary */}
                <div className="mt-3 space-y-1 border-t border-surface-variant/70 pt-2 text-[11px] text-on-surface-variant">
                  <div className="flex gap-1.5">
                    <Icon name="input" className="mt-px shrink-0 text-[14px] text-outline" />
                    <span className="min-w-0 break-words">
                      <span className="text-outline">runs after: </span>
                      {wiringSummary(selectedNode.id).insTxt}
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    <Icon name="output" className="mt-px shrink-0 text-[14px] text-outline" />
                    <span className="min-w-0 break-words">
                      <span className="text-outline">leads to: </span>
                      {wiringSummary(selectedNode.id).outsTxt}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="card !rounded-lg p-3 text-xs leading-relaxed text-on-surface-variant">
                <Icon name="open_in_full" className="mb-1 text-[18px] text-outline" />
                Click a node on the canvas to edit it. Drag from its coloured ports to connect nodes — green runs on
                approve, red runs on reject.
              </div>
            )}

            {/* readiness */}
            <div className={`card !rounded-lg p-3 ${issues.length > 0 ? "!border-amber-300" : ""}`}>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-outline">
                <Icon
                  name={issues.length > 0 ? "fact_check" : "check_circle"}
                  className={`text-[15px] ${issues.length > 0 ? "text-amber-600" : "text-green-600"}`}
                />
                Readiness
              </h3>
              {issues.length === 0 ? (
                <p className="text-xs text-tertiary">
                  {approvalCount === 0
                    ? "No approval in this flow — requests skip straight to the end. Your automations still run."
                    : "Looks good. Save to publish."}
                </p>
              ) : (
                <ul className="space-y-1">
                  {issues.map((x, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => x.key && setSelectedIds([x.key])}
                        className="flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left text-xs text-on-surface-variant hover:bg-secondary-fixed"
                      >
                        <Icon name="error" className="mt-px shrink-0 text-[14px] text-amber-600" />
                        <span>
                          {x.key ? <span className="font-semibold text-on-surface">{nodeTitle(x.key)}: </span> : null}
                          {x.reason}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* used by */}
            {!onDemand && (
              <div className="card !rounded-lg p-3">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-outline">Used by forms</h3>
                {templates.length === 0 && <p className="text-xs text-outline">No form templates yet.</p>}
                <div className="max-h-48 space-y-0.5 overflow-y-auto">
                  {templates.map((t) => (
                    <label key={t.FormTemplateID} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-surface-container-low">
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
                      <span className="min-w-0 flex-1 truncate text-on-surface">{t.Name}</span>
                      <span className={`text-[10px] ${t.Status === "ACTIVE" ? "text-green-600" : "text-outline"}`}>
                        {t.Status === "ACTIVE" ? "live" : t.Status.toLowerCase()}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="card !rounded-lg p-3 text-[11px] leading-relaxed text-outline">
              Drag nodes anywhere — the layout is saved too. <kbd className="rounded border border-surface-variant px-1">/</kbd>{" "}
              searches the palette, <kbd className="rounded border border-surface-variant px-1">⌘S</kbd> saves,{" "}
              <kbd className="rounded border border-surface-variant px-1">⌘Z</kbd> undoes structure, Delete removes a
              selected node.
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
