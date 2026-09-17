"use client";

/**
 * React Flow node cards for the workflow canvas.
 *
 * Every card is an n8n-style compact tile: a colored icon chip, a title, a
 * one-line summary of what it does, and coloured ports —
 *   · approval nodes expose a green "approve" port and a red "reject" port
 *   · end nodes accept any number of inputs
 * The full settings live in the right-hand config rail; the card only shows
 * enough to read the flow at a glance.
 */

import { createContext, useContext } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Icon } from "@/components/ui";
import type { FlowNode, ToolId } from "@/lib/workflow-builder";
import { statusMeta, toolMeta } from "@/lib/workflow-tools";
import { NOTIFY_TARGET_TYPES } from "@/lib/workflow-rules";

/* ---------------------------------------------------------------- types -- */

export interface RoleRow {
  id: string;
  name: string;
}
export interface GroupRow {
  id: string;
  name: string;
}
export interface DepRow {
  DEPID: string;
  Name: string;
  Code?: string;
}
export interface UserRow {
  UserID: string;
  Name: string;
  Email: string;
}
export interface SlaRow {
  id: string;
  name: string;
}

export interface WfLookups {
  users: UserRow[];
  groups: GroupRow[];
  roles: RoleRow[];
  deps: DepRow[];
  slas: SlaRow[];
}

interface WfNodeCtxValue {
  lookups: WfLookups;
  /** node id → human problems (shown as an amber badge on the card) */
  issues: Record<string, string[]>;
  onPatch: (id: string, patch: Partial<FlowNode>) => void;
  onRemove: (id: string) => void;
  ro: boolean;
}

const EMPTY_LOOKUPS: WfLookups = { users: [], groups: [], roles: [], deps: [], slas: [] };
const WfNodeContext = createContext<WfNodeCtxValue>({
  lookups: EMPTY_LOOKUPS,
  issues: {},
  onPatch: () => {},
  onRemove: () => {},
  ro: false,
});
export const WfNodeProvider = WfNodeContext.Provider;
export function useWfCtx(): WfNodeCtxValue {
  return useContext(WfNodeContext);
}

/* ---------------------------------------------------------------- ports -- */

const HANDLE_BASE =
  "!m-1.5 h-3.5 w-3.5 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.14)] transition-transform hover:scale-125";

function Port({
  id,
  type,
  position,
  tone,
}: {
  id: string;
  type: "source" | "target";
  position: Position;
  tone: "out" | "approve" | "reject" | "target";
}) {
  const fill =
    tone === "approve"
      ? "bg-[#15803d]"
      : tone === "reject"
        ? "bg-[#dc2626]"
        : tone === "out"
          ? "bg-primary"
          : "bg-[#8b98b3]";
  return <Handle id={id} type={type} position={position} className={`${HANDLE_BASE} ${fill}`} />;
}

/* -------------------------------------------------------------- summaries -- */

export function approverSummary(n: FlowNode, l: WfLookups): string {
  switch (n.approverType) {
    case "DEPARTMENT_MANAGER":
      return "requester's dept manager";
    case "REQUESTER_MANAGER":
      return "requester's direct manager";
    case "USER":
      return l.users.find((u) => u.UserID === n.targetUserId)?.Name || "a person";
    case "GROUP":
      return l.groups.find((g) => g.id === n.targetGroupId)?.name || "a group";
    case "ROLE":
      return l.roles.find((r) => r.id === n.targetRoleId)?.name || "a role";
    case "ANY_APPROVER":
      return "anyone who may approve";
    default:
      return "who decides?";
  }
}

export function actionSummary(n: FlowNode, l: WfLookups): string {
  switch (n.tool) {
    case "SET_PRIORITY":
      return n.priority ? `priority → ${n.priority}` : "set priority";
    case "SET_STATUS":
      return n.status ? `status → ${statusMeta(n.status)?.label ?? n.status}` : "set ticket status";
    case "SET_SLA":
      return l.slas.find((s) => s.id === n.slaPolicyId)?.name ? `SLA → ${l.slas.find((s) => s.id === n.slaPolicyId)?.name}` : "apply SLA";
    case "ASSIGN_TO_USER":
      return `assign → ${l.users.find((u) => u.UserID === n.userId)?.Name ?? "a person"}`;
    case "ASSIGN_TO_GROUP":
      return `assign → ${l.groups.find((g) => g.id === n.assignGroupId)?.name ?? "a group"}`;
    case "ASSIGN_TO_DEPARTMENT":
      return `assign → ${l.deps.find((d) => d.DEPID === n.assignDepId)?.Name ?? "a department"}`;
    case "NOTIFY": {
      const who =
        n.notifyTargetType === "USER"
          ? l.users.find((u) => u.UserID === n.notifyUserId)?.Name
          : n.notifyTargetType === "GROUP"
            ? l.groups.find((g) => g.id === n.notifyGroupId)?.name
            : n.notifyTargetType === "ROLE"
              ? l.roles.find((r) => r.id === n.notifyRoleId)?.name
              : n.notifyTargetType
            ;
      return `notify ${n.notifyTargetType ? NOTIFY_TARGET_TYPES.find((t) => t.value === n.notifyTargetType)?.label?.toLowerCase() ?? "" : ""}${who ? ` → ${who}` : ""}`.trim() || "notify people";
    }
    case "JUMP_TO_STEP":
      return "jump to a node";
    default:
      return toolMeta(n.tool as ToolId)?.label ?? "action";
  }
}

/* ----------------------------------------------------------------- frame -- */

function Card({
  selected,
  issues,
  onDelete,
  children,
  className = "",
}: {
  selected: boolean;
  issues: string[];
  onDelete?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const { ro } = useWfCtx();
  return (
    <div
      className={`group relative w-[236px] rounded-[10px] border bg-white text-left shadow-[0_1px_2px_rgba(16,24,40,0.08),0_1px_3px_rgba(16,24,40,0.1)] transition-shadow ${
        selected ? "border-primary ring-2 ring-primary/25" : "border-[#c9d2e3] hover:shadow-[0_2px_6px_rgba(16,24,40,0.14)]"
      } ${className}`}
    >
      {onDelete && !ro && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete node"
          className="absolute -right-2 -top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-[#e5c1c1] bg-white text-[#b42318] opacity-0 shadow-sm transition-opacity hover:bg-[#fef3f2] group-hover:opacity-100"
        >
          <Icon name="close" className="text-[13px]" />
        </button>
      )}
      {issues.length > 0 && (
        <span
          title={issues.join("\n")}
          className="absolute -left-1.5 -top-1.5 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-1 text-[10px] font-bold text-amber-700 shadow-sm"
        >
          {issues.length}
        </span>
      )}
      {children}
    </div>
  );
}

function IconChip({ name, accent }: { name: string; accent: string }) {
  return (
    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${accent}`}>
      <Icon name={name} className="text-[17px]" />
    </span>
  );
}

/* ----------------------------------------------------------------- nodes -- */

export function StartNode(_: NodeProps) {
  const { issues, ro } = useWfCtx();
  return (
    <Card selected={_.selected} issues={issues[_.id] ?? []}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <IconChip name="play_circle" accent="bg-emerald-50 text-emerald-700 border-emerald-200" />
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-outline">Trigger</div>
          <div className="truncate text-[13px] font-semibold text-on-surface">Request submitted</div>
        </div>
        <Port id="out" type="source" position={Position.Right} tone="out" />
      </div>
      <div className="border-t border-[#eef1f7] px-3 py-1.5 text-[11px] leading-snug text-on-surface-variant">
        the moment a request enters the queue{ro ? "" : " — drag actions onto its port"}
      </div>
    </Card>
  );
}

export function ApprovalNode(n: NodeProps) {
  const ctx = useWfCtx();
  const d = n.data as unknown as FlowNode;
  const hasCond = d.condField && d.condField !== "none";
  return (
    <Card selected={n.selected} issues={ctx.issues[n.id] ?? []} onDelete={() => ctx.onRemove(n.id)}>
      <div className="px-3 pt-2.5">
        <div className="flex items-center gap-2.5">
          <IconChip name="verified_user" accent="bg-surface-container-low text-primary-dark border-surface-variant" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-outline">Approval</div>
            <div className="truncate text-[13px] font-semibold text-on-surface">{d.name || "Untitled approval"}</div>
          </div>
          <Port id="in" type="target" position={Position.Left} tone="target" />
        </div>
        <div className="mt-1.5 truncate text-[11px] text-on-surface-variant">
          <Icon name="person" className="mr-1 inline text-[13px] align-[-1px] text-outline" />
          {approverSummary(d, ctx.lookups)}
        </div>
        {hasCond && (
          <div className="mt-1 truncate rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            <Icon name="if_while" className="mr-1 inline text-[12px] align-[-1px]" />
            only if {d.condField} {d.condOp} {d.condValue}
          </div>
        )}
      </div>
      <div className="relative mt-1.5 flex items-center justify-between border-t border-dashed border-[#e3e8f2] px-3 pb-1.5 pt-1">
        <span className="flex items-center gap-1 text-[10px] font-semibold text-[#15803d]">
          <Icon name="check_circle" className="text-[13px]" /> approved
        </span>
        <span className="flex items-center gap-1 text-[10px] font-semibold text-[#b42318]">
          <Icon name="cancel" className="text-[13px]" /> rejected
        </span>
        {/* the two decision ports on the bottom edge, under their labels */}
        <Handle
          id="approve"
          type="source"
          position={Position.Bottom}
          style={{ left: "25%" }}
          className={`${HANDLE_BASE} bg-[#15803d]`}
        />
        <Handle
          id="reject"
          type="source"
          position={Position.Bottom}
          style={{ left: "75%" }}
          className={`${HANDLE_BASE} bg-[#dc2626]`}
        />
      </div>
    </Card>
  );
}

export function ActionNode(n: NodeProps) {
  const ctx = useWfCtx();
  const d = n.data as unknown as FlowNode;
  const meta = toolMeta(d.tool as ToolId);
  const hasCond = d.condField && d.condField !== "none";
  return (
    <Card selected={n.selected} issues={ctx.issues[n.id] ?? []} onDelete={() => ctx.onRemove(n.id)}>
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <IconChip name={meta?.icon ?? "bolt"} accent={meta?.accent ?? "bg-surface-container-low border-surface-variant"} />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-outline">{meta?.label ?? "Action"}</div>
            <div className="truncate text-[12px] font-medium text-on-surface-variant">{actionSummary(d, ctx.lookups)}</div>
          </div>
          <Port id="out" type="source" position={Position.Right} tone="out" />
        </div>
        <Port id="in" type="target" position={Position.Left} tone="target" />
        {hasCond && (
          <div className="mt-1.5 truncate rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            <Icon name="if_while" className="mr-1 inline text-[12px] align-[-1px]" />
            only if {d.condField} {d.condOp} {d.condValue}
          </div>
        )}
      </div>
    </Card>
  );
}

export function EndNode(n: NodeProps) {
  const ctx = useWfCtx();
  const approved = n.type === "wf_end_approved";
  return (
    <Card selected={n.selected} issues={ctx.issues[n.id] ?? []} onDelete={() => ctx.onRemove(n.id)}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <IconChip
          name={approved ? "task_alt" : "block"}
          accent={approved ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}
        />
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-outline">{approved ? "End · approved" : "End · rejected"}</div>
          <div className="truncate text-[12px] font-medium text-on-surface-variant">
            {approved ? "the request completes" : "the request is closed"}
          </div>
        </div>
        <Port id="in" type="target" position={Position.Left} tone="target" />
      </div>
    </Card>
  );
}

export const WF_NODE_TYPES = {
  wf_start: StartNode,
  wf_approval: ApprovalNode,
  wf_action: ActionNode,
  wf_end_approved: EndNode,
  wf_end_rejected: EndNode,
};
