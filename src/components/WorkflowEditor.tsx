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
import { useRouter } from "next/navigation";
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
import type { FlowNode, ToolId } from "@/lib/workflow-builder";
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
  templateCount,
  onAdd,
  onRecipe,
}: {
  ro: boolean;
  preset: boolean;
  templateCount: number;
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
          const items = needle ? s.items.filter((i) => (i.label + i.blurb).toLowerCase().includes(needle)) : s.items;
          if (items.length === 0) return null;
          return (
            <div key={s.name}>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-outline">{s.name}</div>
              <div className="space-y-1">
                {items.map((it) => {
                  // the trigger is contextual: preset workflows start on the
                  // Request Approval button click, not on submit
                  const isStart = it.kind === "start";
                  const both = preset && templateCount > 0;
                  const label = isStart
                    ? preset
                      ? both
                        ? "Submitted · or requested"
                        : "Approval requested"
                      : it.label
                    : it.label;
                  const blurb = isStart
                    ? preset
                      ? both
                        ? "on submit — or when the button is pressed in a ticket"
                        : "the moment the Request Approval button is pressed"
                      : it.blurb
                    : it.blurb;
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
  const [onDemand, setOnDemand] = useState(false);
  const [graph, setGraph] = useState<Graph>(EMPTY_GRAPH);
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

  const dirty = useMemo(
    () => JSON.stringify({ name, description, status, onDemand, graph }) !== baseline.current,
    [name, description, status, onDemand, graph]
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
          setUsage(w.usage ?? null);
          setGraph(g);
          setCanvasKey((k) => k + 1);
          setSelectedIds([]);
          baseline.current = JSON.stringify({ name: w.Name, description: w.Description ?? "", status: w.Status, onDemand: Boolean(w.OnDemand), graph: g });
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
    const list = validateGraph(graph);
    if (!name.trim()) list.unshift({ key: null, reason: "Give the workflow a name" });
    return list;
  }, [graph, name]);

  const nodeTitle = useCallback((id: string) => {
    const n = graph.nodes.find((x) => x.id === id);
    if (!n) return "a deleted node";
    if (n.kind === "start") {
      if (onDemand) return (usage?.templates ?? 0) > 0 ? "Submitted · or requested" : "Approval requested";
      return "Request submitted";
    }
    if (n.kind === "approval") return n.data.name || "Untitled approval";
    return toolMeta(n.data.tool as ToolId)?.label ?? "a node";
  }, [graph, onDemand, usage]);

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
    const built = graphToApi(live, { slas, users, groups, departments: deps });
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
      const h = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      for (const tid of Array.from(assigned)) {
        if (!initialAssigned.has(tid) && savedId)
          await fetch(`/api/form-templates/${tid}`, { method: "PATCH", headers: h, body: JSON.stringify({ wfDefinitionId: savedId }) });
      }
      for (const tid of Array.from(initialAssigned)) {
        if (!assigned.has(tid))
          await fetch(`/api/form-templates/${tid}`, { method: "PATCH", headers: h, body: JSON.stringify({ wfDefinitionId: null }) });
      }
      baseline.current = JSON.stringify({ name, description, status, onDemand, graph: savedGraph });
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
          <Link href="/workflows" className="icon-btn !h-8 !w-8 shrink-0" title="Back to workflows">
            <Icon name="arrow_back" className="text-[19px]" />
          </Link>
          <input
            className="min-w-0 flex-1 border-b border-transparent bg-transparent text-lg font-bold tracking-tight text-on-surface outline-none hover:border-surface-variant focus:border-primary"
            value={name}
            disabled={ro}
            placeholder="Untitled workflow"
            onChange={(e) => setName(e.target.value)}
          />
          <StatusBadge status={status} />
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
          <label
            className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] font-medium text-on-surface-variant"
            title="Show this workflow as a button inside open requests (“Request approval”) — an agent stuck on a ticket can start it on demand. It still works when attached to a form template."
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-primary"
              disabled={ro}
              checked={onDemand}
              onChange={(e) => setOnDemand(e.target.checked)}
            />
            Request-approval preset
          </label>
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
              templateCount={usage?.templates ?? 0}
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
                  {selectedNode.kind !== "start" && !ro && (
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
                  <p className="text-xs leading-relaxed text-on-surface-variant">
                    {onDemand ? (
                      (usage?.templates ?? 0) > 0 ? (
                        <>
                          This is the trigger. When the workflow is attached to a form, everything wired to this
                          node&apos;s port runs the moment the request is submitted; and because it&apos;s a
                          request-approval preset, the chain also starts whenever someone presses{" "}
                          <span className="font-semibold text-on-surface">Request Approval</span> inside a ticket.
                          It cannot be deleted — wire your first node to its port.
                        </>
                      ) : (
                        <>
                          This is the trigger — and for a preset there is no &ldquo;submit&rdquo;: the whole chain
                          starts the moment someone presses{" "}
                          <span className="font-semibold text-on-surface">Request Approval</span> inside a ticket.
                          Wire your first node (e.g. the accountant&apos;s approval) to its port. It cannot be
                          deleted, and it never changes the ticket&apos;s status.
                        </>
                      )
                    ) : (
                      <>
                        Everything wired to this node&apos;s port runs the moment the request is submitted — before
                        anybody approves anything. It cannot be deleted, but its port can feed as many actions as
                        you like.
                      </>
                    )}
                  </p>
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
