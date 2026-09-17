"use client";

/**
 * Workflow builder — a canvas you fill yourself.
 *
 * Three panels, the way n8n / ServiceNow Flow Designer lay it out:
 *   left   tools palette (searchable, grouped, draggable)
 *   middle the canvas: nodes in the order you drop them
 *   right  flow map, readiness list, attached forms
 *
 * Nothing is pre-created. There is no hidden "start" step, no fixed lanes with
 * settings in them. Every node — including the submit marker — comes from the
 * palette and every node can be deleted.
 *
 * How a node is wired:
 *   START      marker for the moment the request is submitted (no settings)
 *   APPROVAL   a real approval step; exposes two drop ports: "if approved" and "if rejected"
 *   actions    set priority / set ticket status / apply SLA / assign / notify / jump
 *
 * Dropping an action into a port (or picking "Runs when" in the node) is what binds
 * it. The binding is stored in WFRules.ActionValue.fireOnStepOrder, so the schema
 * does not change.
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
import { NOTIFY_TARGET_TYPES } from "@/lib/workflow-rules";
import {
  apiToNodes,
  approvalLabel,
  attachment,
  approvalNodes,
  cloneNode,
  END_KEY,
  isActionTool,
  nodesToApi,
  newNode,
  patchNode,
  slotChildren,
  startNode,
  type FlowNode,
  type SlotId,
  type ToolId,
  type WhenId,
} from "@/lib/workflow-builder";
import {
  fmtMins,
  RECIPES,
  SETTABLE_STATUSES,
  statusMeta,
  TOOLS,
  toolCategories,
  whenMeta,
  toolMeta,
  WHEN_META,
  WHEN_ORDER,
} from "@/lib/workflow-tools";

/* ------------------------------------------------------------- data shapes -- */

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

/* --------------------------------------------------------------- options -- */

const APPROVER_TYPES = [
  { value: "DEPARTMENT_MANAGER", label: "Requester's dept manager" },
  { value: "REQUESTER_MANAGER", label: "Requester's direct manager" },
  { value: "USER", label: "One person" },
  { value: "GROUP", label: "A group" },
  { value: "ROLE", label: "A role" },
  { value: "ANY_APPROVER", label: "Anyone who may approve" },
];

const ACTION_TOOLS: ToolId[] = TOOLS.filter((t) => t.kind === "action").map((t) => t.id);

function whenText(n: FlowNode, nodes: FlowNode[]): string {
  if (!n.when) return "when? pick it, or drop the node on a port";
  const meta = WHEN_META[n.when];
  if (n.when === "AFTER_APPROVE" || n.when === "AFTER_REJECT" || n.when === "AFTER_DECISION") {
    const label = approvalLabel(nodes, n.attachKey);
    return label ? `${meta.short} · ${label}` : `${meta.short} · ⚠ pick the node`;
  }
  return meta.short;
}

/* ------------------------------------------------------------- UI atoms -- */

function Segmented({
  options,
  value,
  onChange,
  disabled,
  size = "sm",
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  size?: "sm" | "xs";
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`rounded border font-medium transition-colors ${
            size === "xs" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
          } ${
            value === o.value
              ? "border-primary bg-surface-container-low text-primary-dark"
              : "border-surface-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low"
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

function ConditionRow({
  n,
  disabled,
  onPatch,
}: {
  n: FlowNode;
  disabled?: boolean;
  onPatch: (p: Partial<FlowNode>) => void;
}) {
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
          <select
            className="input w-auto !py-1.5 text-xs"
            disabled={disabled}
            value={n.condOp}
            onChange={(e) => onPatch({ condOp: e.target.value })}
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
              value={n.condValue}
              onChange={(e) => onPatch({ condValue: e.target.value })}
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

/** the popover used to add a tool into a port without dragging */
function AddMenu({
  open,
  onPick,
  onClose,
  tools = ACTION_TOOLS,
}: {
  open: boolean;
  onPick: (t: ToolId) => void;
  onClose: () => void;
  tools?: ToolId[];
}) {
  if (!open) return null;
  return (
    <div className="absolute right-0 top-full z-50 mt-1 w-60 rounded-lg border border-surface-variant bg-surface-container-lowest p-1 shadow-tier2">
      <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-outline">Add a tool</div>
      {tools.map((id) => {
        const t = toolMeta(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              onPick(id);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-on-surface hover:bg-surface-container-low"
          >
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border ${t.accent}`}>
              <Icon name={t.icon} className="text-[14px]" />
            </span>
            {t.label}
          </button>
        );
      })}
      <div className="border-t border-surface-variant/60 px-2 py-1 text-[10px] text-outline">
        or drag from the tools panel
      </div>
      <button
        type="button"
        onClick={onClose}
        className="absolute right-1 top-1 rounded p-1 text-outline hover:text-on-surface"
        title="Close"
      >
        <Icon name="close" className="text-[14px]" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------- ctx -- */

type Drag = { kind: "new"; tool: ToolId } | { kind: "move"; key: string } | null;

interface ZoneHandlers {
  drag: Drag;
  hover: string | null;
  enter: (id: string) => void;
  leave: () => void;
  dropOnLine: (before: FlowNode | null) => void;
  dropInSlot: (parentKey: string, slot: SlotId, before: FlowNode | null) => void;
  addToSlot: (parentKey: string, slot: SlotId, tool: ToolId) => void;
  startToolDrag: (t: ToolId) => void;
  startNodeDrag: (k: string) => void;
  endDrag: () => void;
}

interface NodeCtx extends ZoneHandlers {
  nodes: FlowNode[];
  roles: RoleRow[];
  groups: GroupRow[];
  users: UserRow[];
  slas: SlaRow[];
  ro: boolean;
  selected: string | null;
  select: (k: string | null) => void;
  patch: (k: string, p: Partial<FlowNode>) => void;
  remove: (k: string) => void;
  duplicate: (k: string) => void;
  moveWithin: (k: string, dir: -1 | 1) => void;
  detach: (k: string) => void;
  issues: Record<string, string[]>;
}

/** props for a div that accepts a drop; `zoneId` marks it as the active target */
function zoneProps(ctx: NodeCtx, zoneId: string, onDrop: () => void) {
  return {
    onDragOver: (e: React.DragEvent) => {
      if (!ctx.drag) return;
      e.preventDefault();
      // must match the effectAllowed set on drag start — the palette drags a NEW tool (copy),
      // the canvas drags an existing node (move); a mismatch cancels the drop entirely
      e.dataTransfer.dropEffect = ctx.drag.kind === "new" ? "copy" : "move";
      ctx.enter(zoneId);
    },
    onDragLeave: () => ctx.leave(),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      onDrop();
    },
  };
}

/* ------------------------------------------------------------- slot (port) -- */

function Port({
  title,
  tone,
  icon,
  parentKey,
  slot,
  ctx,
  depth,
}: {
  title: string;
  tone: "approve" | "reject" | "submit" | "decision";
  icon: string;
  parentKey: string;
  slot: SlotId;
  ctx: NodeCtx;
  depth: number;
}) {
  const [menu, setMenu] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menu]);
  const kids = slotChildren(ctx.nodes, parentKey, slot);
  const toneCls =
    tone === "approve"
      ? "text-tertiary border-green-200 bg-green-50/50"
      : tone === "reject"
        ? "text-rose-700 border-rose-200 bg-rose-50/50"
        : tone === "submit"
          ? "text-emerald-700 border-emerald-200 bg-emerald-50/40"
          : "text-indigo-700 border-indigo-200 bg-indigo-50/40";
  const zoneId = `${parentKey}:${slot}`;
  return (
    <div className={`relative rounded-lg border ${toneCls} p-2`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider">
          <Icon name={icon} className="text-[14px]" />
          {title}
          {kids.length > 0 && <span className="rounded-full bg-surface-container-lowest/70 px-1.5 text-[10px]">{kids.length}</span>}
        </span>
        {!ctx.ro && (
          <div ref={menuWrapRef} className="relative">
            <button
              type="button"
              onClick={() => setMenu((m) => !m)}
              className="inline-flex items-center gap-0.5 rounded-full border border-current/40 bg-surface-container-lowest/80 px-2 py-0.5 text-[11px] font-bold hover:bg-surface-container-lowest"
              title="Add a tool to this port"
            >
              <Icon name="add" className="text-[13px]" />
              add
            </button>
            <AddMenu
              open={menu}
              onClose={() => setMenu(false)}
              onPick={(t) => ctx.addToSlot(parentKey, slot, t)}
              tools={ACTION_TOOLS}
            />
          </div>
        )}
      </div>

      {kids.map((k, ki) => (
        <div
          key={k.key}
          {...zoneProps(ctx, `${zoneId}@${ki}`, () => ctx.dropInSlot(parentKey, slot, k))}
          className="rounded"
        >
          <NodeCard n={k} ctx={ctx} depth={depth + 1} />
        </div>
      ))}

      <div
        {...zoneProps(ctx, `${zoneId}@end`, () => ctx.dropInSlot(parentKey, slot, null))}
        className={`mt-1 flex min-h-[30px] items-center justify-center rounded border border-dashed px-2 text-[11px] ${
          ctx.hover === `${zoneId}@end` ? "border-primary bg-surface-container-lowest" : "border-black/10"
        } ${kids.length === 0 ? "text-outline" : "text-transparent"}`}
      >
        {kids.length === 0 ? (ctx.drag ? "drop here" : "empty — drag a tool here or press add") : "·"}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- node card -- */

function NodeCard({ n, ctx, depth = 0 }: { n: FlowNode; ctx: NodeCtx; depth?: number }) {
  const meta = toolMeta(n.tool);
  const issues = ctx.issues[n.key] ?? [];
  const isApproval = n.tool === "APPROVAL";
  const isStart = n.tool === "START";
  const approvals = approvalNodes(ctx.nodes);
  const approvalIdx = isApproval ? approvals.findIndex((a) => a.key === n.key) : -1;
  const attached = Boolean(attachment(ctx.nodes, n));
  void approvalIdx;
  const nested = depth > 0;

  const p = (patch: Partial<FlowNode>) => ctx.patch(n.key, patch);
  const approveKids = slotChildren(ctx.nodes, n.key, "approve");
  const rejectKids = slotChildren(ctx.nodes, n.key, "reject");
  const sla = !isApproval && !isStart ? ctx.slas.find((s) => s.id === n.slaPolicyId) : undefined;

  return (
    <div
      id={`node-${n.key}`}
      onClick={() => ctx.select(n.key)}
      className={`${nested ? "" : "card"} ${nested ? "mb-1 rounded-lg border bg-surface-container-lowest" : "mb-2"} ${
        ctx.selected === n.key ? "ring-2 ring-primary/30" : ""
      } ${issues.length > 0 ? "border-amber-300" : ""} ${!n.enabled && !isStart ? "opacity-70" : ""}`}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          disabled={ctx.ro}
          draggable={!ctx.ro}
          onDragStart={(e) => {
            // setData is required for the drag to start at all (Firefox); "move" pairs with the canvas zones
            e.dataTransfer.setData("text/plain", n.key);
            e.dataTransfer.effectAllowed = "move";
            ctx.startNodeDrag(n.key);
          }}
          onDragEnd={ctx.endDrag}
          onClick={() => p({ open: !n.open })}
          title={ctx.ro ? meta.label : "Drag to move · click to open or close"}
          className={`flex h-6 shrink-0 cursor-grab items-center justify-center rounded border px-1 ${meta.accent}`}
        >
          <Icon name={meta.icon} className="text-[14px]" />
        </button>
        <span className="hidden shrink-0 text-[10px] font-bold uppercase tracking-wider text-outline sm:block">
          {isStart ? "start" : isApproval ? "decision" : meta.label}
        </span>
        {isStart ? (
          <span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-on-surface">Requester submits</span>
        ) : (
          <input
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-on-surface outline-none hover:border-surface-variant focus:border-primary focus:bg-surface-container-lowest"
            value={n.name}
            disabled={ctx.ro}
            placeholder={isApproval ? "unnamed — click to name it" : "label (optional)"}
            onChange={(e) => p({ name: e.target.value })}
          />
        )}

        {!isApproval && !isStart && (
          <span className="hidden shrink-0 items-center gap-1 text-[10px] text-outline md:flex">
            <Icon name={whenMeta(n.when).icon} className="text-[13px]" />
            {whenText(n, ctx.nodes)}
          </span>
        )}
        {sla && n.priority && (
          <span className="hidden shrink-0 rounded bg-cyan-50 px-1.5 py-0.5 text-[10px] text-cyan-700 lg:block">
            TTA {fmtMins(sla.targets?.find((t) => t.priority === n.priority)?.responseMins ?? sla.targets?.[0]?.responseMins)} · TTR{" "}
            {fmtMins(sla.targets?.find((t) => t.priority === n.priority)?.resolveMins ?? sla.targets?.[0]?.resolveMins)}
          </span>
        )}
        {isStart && <span className="shrink-0 text-[10px] text-outline">no settings — it is just the hook</span>}
        {!n.enabled && !isStart && <span className="shrink-0 rounded bg-surface-container px-1.5 text-[10px] text-outline">paused</span>}
        {issues.length > 0 && (
          <span className="shrink-0 rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-on-secondary-fixed-variant" title={issues[0]}>
            {issues.length}
          </span>
        )}

        <div className="flex shrink-0 items-center">
          {issues[0] && <span className="mr-1 hidden max-w-[220px] truncate text-[10px] text-amber-700 xl:block">{issues[0]}</span>}
          {!isStart && (
            <>
              <button type="button" className="icon-btn !h-6 !w-6" title="Move up" onClick={() => ctx.moveWithin(n.key, -1)}>
                <Icon name="keyboard_arrow_up" className="text-[16px]" />
              </button>
              <button type="button" className="icon-btn !h-6 !w-6" title="Move down" onClick={() => ctx.moveWithin(n.key, 1)}>
                <Icon name="keyboard_arrow_down" className="text-[16px]" />
              </button>
            </>
          )}
          <button
            type="button"
            className="icon-btn !h-6 !w-6"
            title={n.open ? "Collapse" : "Open"}
            onClick={() => p({ open: !n.open })}
          >
            <Icon name={n.open ? "expand_less" : "expand_more"} className="text-[16px]" />
          </button>
        </div>
      </div>

      {n.open && (
        <div className="space-y-3 border-t border-surface-variant/70 px-3 py-2.5">
          {isStart ? (
            <p className="text-[11px] leading-relaxed text-on-surface-variant">
              Everything you drop in the port below runs the moment the request is submitted — before anybody
              approves anything. Delete this node if you do not need a submit hook.
            </p>
          ) : isApproval ? (
            <ApprovalBody n={n} ctx={ctx} />
          ) : (
            <ActionBody n={n} ctx={ctx} />
          )}

          {isApproval && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Port title="If approved" tone="approve" icon="thumb_up" parentKey={n.key} slot="approve" ctx={ctx} depth={depth} />
              <Port title="If rejected" tone="reject" icon="thumb_down" parentKey={n.key} slot="reject" ctx={ctx} depth={depth} />
            </div>
          )}
          {isStart && <Port title="Then run" tone="submit" icon="bolt" parentKey={n.key} slot="submit" ctx={ctx} depth={depth} />}

          {n.condField !== "none" && !n.open && (
            <div className="px-3 pb-2 text-[10px] text-outline">
              only if {n.condField} {n.condOp} {n.condValue}
            </div>
          )}

          {!ctx.ro && (
            <div className="flex flex-wrap items-center gap-3 border-t border-surface-variant/60 pt-2 text-[11px]">
              <button type="button" onClick={() => ctx.duplicate(n.key)} className="text-on-surface-variant hover:text-primary">
                Duplicate
              </button>
              {attached && (
                <button type="button" onClick={() => ctx.detach(n.key)} className="text-on-surface-variant hover:text-primary">
                  Move to the main line
                </button>
              )}
              {!isStart && !isApproval && (
                <button type="button" onClick={() => p({ enabled: !n.enabled })} className="text-on-surface-variant hover:text-primary">
                  {n.enabled ? "Pause" : "Resume"}
                </button>
              )}
              <button type="button" onClick={() => ctx.remove(n.key)} className="text-on-surface-variant hover:text-danger">
                Delete
              </button>
              {!isStart && (
                <span className="ml-auto text-outline">
                  {isApproval
                    ? `approvals run in canvas order · ${approveKids.length} on approve · ${rejectKids.length} on reject`
                    : `rule order ${ctx.nodes.filter((x) => isActionTool(x.tool)).findIndex((x) => x.key === n.key) + 1}`}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ApprovalBody({ n, ctx }: { n: FlowNode; ctx: NodeCtx }) {
  return (
    <>
      <Field label="Who decides">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            disabled={ctx.ro}
            value={n.approverType}
            onChange={(v) => ctx.patch(n.key, { approverType: v })}
            options={APPROVER_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            size="xs"
          />
          {!n.approverType && (
            <span className="text-[11px] font-medium text-amber-700">pick who decides — nothing is selected</span>
          )}
          {(n.approverType === "USER" || n.approverType === "GROUP" || n.approverType === "ROLE") && (
            <select
              className="input !w-52 !py-1 text-xs"
              disabled={ctx.ro}
              value={n.approverType === "USER" ? n.targetUserId : n.approverType === "GROUP" ? n.targetGroupId : n.targetRoleId}
              onChange={(e) =>
                ctx.patch(
                  n.key,
                  n.approverType === "USER"
                    ? { targetUserId: e.target.value }
                    : n.approverType === "GROUP"
                      ? { targetGroupId: e.target.value }
                      : { targetRoleId: e.target.value }
                )
              }
            >
              <option value="">— choose —</option>
              {n.approverType === "USER" &&
                ctx.users.map((u) => (
                  <option key={u.UserID} value={u.UserID}>
                    {u.Name} · {u.Email}
                  </option>
                ))}
              {n.approverType === "GROUP" &&
                ctx.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              {n.approverType === "ROLE" &&
                ctx.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          )}
        </div>
      </Field>

      <Field label="Only if" hint="The whole node is skipped when this is false">
        <ConditionRow n={n} disabled={ctx.ro} onPatch={(patch) => ctx.patch(n.key, patch)} />
      </Field>

      <p className="text-[10px] leading-relaxed text-outline">
        Approving moves the request to the next node; rejecting ends it. Use the green and red ports below to run
        tools after this decision — drop a tool there only if something should happen.
      </p>
    </>
  );
}

function ActionBody({ n, ctx }: { n: FlowNode; ctx: NodeCtx }) {
  const approvals = approvalNodes(ctx.nodes);
  const needsPick = n.when === "AFTER_APPROVE" || n.when === "AFTER_REJECT" || n.when === "AFTER_DECISION";
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Runs when">
          <select
            className="input !py-1 text-xs"
            disabled={ctx.ro}
            value={n.when}
            onChange={(e) =>
              ctx.patch(n.key, {
                when: e.target.value as WhenId,
                attachKey: e.target.value.startsWith("AFTER_") ? n.attachKey || approvals[0]?.key || "" : "",
              })
            }
          >
            <option value="">— when should this run? —</option>
            {WHEN_ORDER.map((w) => (
              <option key={w} value={w}>
                {WHEN_META[w].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={needsPick ? "Attached to" : "This node does"}>
          {needsPick ? (
            <select
              className="input !py-1 text-xs"
              disabled={ctx.ro}
              value={n.attachKey}
              onChange={(e) => ctx.patch(n.key, { attachKey: e.target.value })}
            >
              <option value="">— choose an approval node —</option>
              {approvals.map((a, ai) => (
                <option key={a.key} value={a.key}>
                  {ai + 1}. {a.name || "Untitled approval"}
                </option>
              ))}
            </select>
          ) : (
            <select
              className="input !py-1 text-xs"
              disabled={ctx.ro}
              value={n.tool}
              onChange={(e) => ctx.patch(n.key, { tool: e.target.value as ToolId })}
            >
              {TOOLS.filter((t) => t.kind === "action").map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      {n.tool === "SET_PRIORITY" && (
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            disabled={ctx.ro}
            size="xs"
            value={n.priority}
            onChange={(v) => ctx.patch(n.key, { priority: v })}
            options={PRIORITY_VALUES.map((p) => ({ value: p, label: p }))}
          />
          {!n.priority && <span className="text-[11px] font-medium text-amber-700">pick a priority</span>}
        </div>
      )}

      {n.tool === "SET_STATUS" && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input !py-1 text-xs"
            disabled={ctx.ro}
            value={n.status}
            onChange={(e) => ctx.patch(n.key, { status: e.target.value })}
          >
            <option value="">— which status? —</option>
            {SETTABLE_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-outline">
            {n.status ? statusMeta(n.status)?.note : "nothing chosen yet"}
          </span>
        </div>
      )}

      {n.tool === "SET_SLA" && (
        <Field label="Policy" hint="The target matching the request's priority at that moment is applied">
          <select
            className="input !py-1 text-xs"
            disabled={ctx.ro}
            value={n.slaPolicyId}
            onChange={(e) => ctx.patch(n.key, { slaPolicyId: e.target.value })}
          >
            <option value="">— choose a policy —</option>
            {ctx.slas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
          {ctx.slas.find((s) => s.id === n.slaPolicyId)?.targets && (
            <div className="mt-1 flex flex-wrap gap-1">
              {(ctx.slas.find((s) => s.id === n.slaPolicyId)?.targets ?? []).map((t) => (
                <span key={t.priority} className="rounded bg-surface-container px-1.5 py-0.5 text-[10px] text-on-surface-variant">
                  {t.priority}: TTA {fmtMins(t.responseMins)} · TTR {fmtMins(t.resolveMins)}
                </span>
              ))}
            </div>
          )}
        </Field>
      )}

      {n.tool === "ASSIGN_TO_USER" && (
        <select className="input !py-1 text-xs" disabled={ctx.ro} value={n.userId} onChange={(e) => ctx.patch(n.key, { userId: e.target.value })}>
          <option value="">— assign to whom? —</option>
          {ctx.users.map((u) => (
            <option key={u.UserID} value={u.UserID}>
              {u.Name} · {u.Email}
            </option>
          ))}
        </select>
      )}

      {n.tool === "NOTIFY" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            className="input !py-1 text-xs"
            disabled={ctx.ro}
            value={n.notifyTargetType}
            onChange={(e) => ctx.patch(n.key, { notifyTargetType: e.target.value })}
          >
            <option value="">— who to notify? —</option>
            {NOTIFY_TARGET_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {n.notifyTargetType === "USER" && (
            <select className="input !py-1 text-xs" disabled={ctx.ro} value={n.notifyUserId} onChange={(e) => ctx.patch(n.key, { notifyUserId: e.target.value })}>
              <option value="">— which user? —</option>
              {ctx.users.map((u) => (
                <option key={u.UserID} value={u.UserID}>
                  {u.Name}
                </option>
              ))}
            </select>
          )}
          {n.notifyTargetType === "GROUP" && (
            <select className="input !py-1 text-xs" disabled={ctx.ro} value={n.notifyGroupId} onChange={(e) => ctx.patch(n.key, { notifyGroupId: e.target.value })}>
              <option value="">— which group? —</option>
              {ctx.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
          {n.notifyTargetType === "ROLE" && (
            <select className="input !py-1 text-xs" disabled={ctx.ro} value={n.notifyRoleId} onChange={(e) => ctx.patch(n.key, { notifyRoleId: e.target.value })}>
              <option value="">— which role? —</option>
              {ctx.roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
          <input
            className="input !py-1 text-xs"
            disabled={ctx.ro}
            placeholder="Title (optional)"
            value={n.notifyTitle}
            onChange={(e) => ctx.patch(n.key, { notifyTitle: e.target.value })}
          />
          <input
            className="input !py-1 text-xs sm:col-span-2"
            disabled={ctx.ro}
            placeholder="Message (optional)"
            value={n.notifyMessage}
            onChange={(e) => ctx.patch(n.key, { notifyMessage: e.target.value })}
          />
        </div>
      )}

      {n.tool === "JUMP_TO_STEP" && (
        <select className="input !py-1 text-xs" disabled={ctx.ro} value={n.jumpToStepKey} onChange={(e) => ctx.patch(n.key, { jumpToStepKey: e.target.value })}>
          <option value="">— land on which approval node? —</option>
          {approvals.map((a, ai) => (
            <option key={a.key} value={a.key}>
              {ai + 1}. {a.name || "Untitled approval"}
            </option>
          ))}
        </select>
      )}

      <Field label="Only if" hint="The action is skipped when this is false">
        <ConditionRow n={n} disabled={ctx.ro} onPatch={(patch) => ctx.patch(n.key, patch)} />
      </Field>
    </>
  );
}

/* ---------------------------------------------------------------- palette -- */

function Palette({
  ro,
  onAppend,
  drag,
  startToolDrag,
  endDrag,
  onRecipe,
}: {
  ro: boolean;
  onAppend: (t: ToolId) => void;
  drag: Drag;
  startToolDrag: (t: ToolId) => void;
  endDrag: () => void;
  onRecipe: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const cats = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return toolCategories()
      .map((c) => ({
        ...c,
        tools: needle ? c.tools.filter((t) => (t.label + t.blurb + t.category).toLowerCase().includes(needle)) : c.tools,
      }))
      .filter((c) => c.tools.length > 0);
  }, [q]);

  return (
    <div className="card sticky top-4 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon name="construction" className="text-[16px] text-outline" />
        <h3 className="text-xs font-bold uppercase tracking-wider text-outline">Tools</h3>
        <span className="ml-auto text-[10px] text-outline">drag onto the canvas</span>
      </div>
      <input
        id="wf-tool-search"
        className="input mb-2 !py-1 text-xs"
        placeholder="Search tools —  /"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setQ("");
            (e.target as HTMLInputElement).blur();
          }
        }}
      />

      {cats.map((c) => (
        <div key={c.name} className="mb-2">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-outline">{c.name}</div>
          <div className="space-y-1">
            {c.tools.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={ro}
                draggable={!ro}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", t.id);
                  e.dataTransfer.effectAllowed = "copy";
                  startToolDrag(t.id);
                }}
                onDragEnd={endDrag}
                onClick={() => onAppend(t.id)}
                title={ro ? t.blurb : `${t.blurb}\n\nDrag it anywhere on the canvas, or click to add at the end.`}
                className={`flex w-full cursor-grab items-start gap-2 rounded-lg border p-1.5 text-left transition-colors hover:bg-surface-container-low ${
                  drag?.kind === "new" && drag.tool === t.id ? "border-primary bg-surface-container-low" : "border-surface-variant"
                } ${ro ? "cursor-default" : ""}`}
              >
                <span className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded border ${t.accent}`}>
                  <Icon name={t.icon} className="text-[14px]" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-on-surface">{t.label}</span>
                  <span className="block text-[10px] leading-snug text-outline">{t.blurb}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {cats.length === 0 && <p className="py-2 text-center text-[11px] text-outline">No tool matches “{q}”.</p>}

      {!ro && (
        <div className="mt-3 border-t border-surface-variant/70 pt-2">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-outline">Start from a preset (optional)</div>
          {RECIPES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onRecipe(r.id)}
              className="mb-1 flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-surface-container-low"
              title={r.blurb}
            >
              <Icon name={r.icon} className="mt-0.5 text-[15px] text-outline" />
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold text-on-surface">{r.label}</span>
                <span className="block text-[10px] leading-snug text-outline">inserts editable nodes</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ the editor -- */

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
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [usage, setUsage] = useState<LoadedWorkflow["usage"] | null>(null);

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [slas, setSlas] = useState<SlaRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [initialAssigned, setInitialAssigned] = useState<Set<string>>(new Set());

  const [drag, setDrag] = useState<Drag>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const baseline = useRef("");
  const past = useRef<FlowNode[][]>([]);
  const future = useRef<FlowNode[][]>([]);
  const [histTick, setHistTick] = useState(0);

  const dirty = useMemo(
    () => JSON.stringify({ name, description, status, nodes }) !== baseline.current,
    [name, description, status, nodes]
  );
  const history = useMemo(
    () => ({ canUndo: past.current.length > 0, canRedo: future.current.length > 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [histTick]
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
    const next = apiToNodes(w.Steps || [], w.Rules || []);
    setName(w.Name);
    setDescription(w.Description ?? "");
    setStatus(w.Status);
    setUsage(w.usage ?? null);
    setNodes(next);
    past.current = [];
    future.current = [];
    baseline.current = JSON.stringify({ name: w.Name, description: w.Description ?? "", status: w.Status, nodes: next });
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

  /* -------------------------------------------------------- node editing -- */

  const commit = useCallback((next: FlowNode[]) => {
    setNodes((prev) => {
      past.current = [...past.current.slice(-49), prev];
      future.current = [];
      return next;
    });
    setHistTick((t) => t + 1);
  }, []);

  const patch = useCallback(
    (key: string, p: Partial<FlowNode>) => setNodes((prev) => patchNode(prev, key, p)),
    []
  );

  const mainLine = useMemo(() => nodes.filter((n) => !attachment(nodes, n)), [nodes]);

  const whenForSlot = (parentKey: string, slot: SlotId): { when: WhenId; attachKey: string } => {
    if (slot === "submit") return { when: "ON_SUBMIT", attachKey: "" };
    if (slot === "decision") return { when: "AFTER_DECISION", attachKey: parentKey };
    if (slot === "approve") return { when: parentKey === END_KEY ? "FINAL_APPROVE" : "AFTER_APPROVE", attachKey: parentKey === END_KEY ? "" : parentKey };
    if (slot === "reject") return { when: parentKey === END_KEY ? "FINAL_REJECT" : "AFTER_REJECT", attachKey: parentKey === END_KEY ? "" : parentKey };
    return { when: "ANY_APPROVE", attachKey: "" };
  };

  const lineInsertIndex = (list: FlowNode[], before: FlowNode | null) => (before ? list.indexOf(before) : list.length);

  const slotInsertIndex = (list: FlowNode[], parentKey: string, slot: SlotId, before: FlowNode | null) => {
    if (before) return list.indexOf(before);
    const kids = slotChildren(list, parentKey, slot);
    if (kids.length > 0) return list.indexOf(kids[kids.length - 1]) + 1;
    if (parentKey === END_KEY) return list.length;
    const parent = list.find((x) => x.key === parentKey);
    return parent ? list.indexOf(parent) + 1 : list.length;
  };

  const insertAt = (list: FlowNode[], index: number, n: FlowNode) => {
    const next = [...list];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, n);
    commit(next);
    setSelected(n.key);
  };

  const endDrag = () => {
    setDrag(null);
    setHover(null);
  };

  const appendTool = (tool: ToolId) => {
    if (tool === "START" && startNode(nodes)) {
      setError("There is already a submit marker on the canvas — drop your actions on it.");
      return;
    }
    // nothing is chosen for you: no name, no trigger, no payload
    insertAt(nodes, nodes.length, newNode(tool));
  };

  const addToSlot = (parentKey: string, slot: SlotId, tool: ToolId) => {
    const w = whenForSlot(parentKey, slot);
    const n = newNode(tool, { when: w.when, attachKey: w.attachKey });
    insertAt(nodes, slotInsertIndex(nodes, parentKey, slot, null), n);
  };

  const dropOnLine = (before: FlowNode | null) => {
    if (drag?.kind === "new") {
      const tool = drag.tool;
      if (tool === "START" && startNode(nodes)) return endDrag();
      insertAt(nodes, lineInsertIndex(nodes, before), newNode(tool));
      endDrag();
      return;
    }
    if (drag?.kind === "move") {
      const from = nodes.findIndex((x) => x.key === drag.key);
      if (from < 0) return endDrag();
      const moved = nodes[from];
      if (before?.key === drag.key) return endDrag(); // dropped back on itself — keep it where it was
      const next = [...nodes];
      next.splice(from, 1);
      // the gap right under a main-line node is the top of the next card; "insert before
      // that card" is where it already is, so read that drop as "insert after" — otherwise
      // moving a node down one slot looks like nothing happened
      const beforeIndex = before ? nodes.indexOf(before) : -1;
      const target =
        !attachment(nodes, moved) && before && beforeIndex === from + 1
          ? next.indexOf(before) + 1
          : lineInsertIndex(next, before);
      // moving onto the bare line detaches it: it runs after any approval instead
      const patched =
        moved.tool === "APPROVAL" || moved.tool === "START" ? moved : { ...moved, when: "ANY_APPROVE" as WhenId, attachKey: "" };
      next.splice(Math.max(0, Math.min(target, next.length)), 0, patched);
      commit(next);
    }
    endDrag();
  };

  const dropInSlot = (parentKey: string, slot: SlotId, before: FlowNode | null) => {
    const w = whenForSlot(parentKey, slot);
    if (drag?.kind === "new") {
      const tool = drag.tool;
      if (tool === "START" || tool === "APPROVAL") {
        // approvals and the submit marker always live on the main line — never lose the drop
        dropOnLine(null);
        return;
      }
      insertAt(nodes, slotInsertIndex(nodes, parentKey, slot, before), newNode(tool, { when: w.when, attachKey: w.attachKey }));
      endDrag();
      return;
    }
    if (drag?.kind === "move") {
      const from = nodes.findIndex((x) => x.key === drag.key);
      if (from < 0) return endDrag();
      const moved = nodes[from];
      if (before?.key === drag.key) return endDrag(); // dropped back on itself — keep it where it was
      const att = attachment(nodes, moved);
      const sameSlot = Boolean(att && att.parentId === parentKey && att.slot === slot);
      const next = [...nodes];
      next.splice(from, 1);
      // same as on the main line: the top of the next sibling in this port reads as "after it"
      const beforeIndex = before ? nodes.indexOf(before) : -1;
      const target =
        sameSlot && before && beforeIndex === from + 1 ? next.indexOf(before) + 1 : slotInsertIndex(next, parentKey, slot, before);
      next.splice(Math.max(0, Math.min(target, next.length)), 0, {
        ...moved,
        when: moved.tool === "APPROVAL" || moved.tool === "START" ? moved.when : w.when,
        attachKey: moved.tool === "APPROVAL" || moved.tool === "START" ? "" : w.attachKey,
      });
      commit(next);
    }
    endDrag();
  };

  const removeNode = (key: string) => {
    const gone = nodes.find((n) => n.key === key);
    let next = nodes.filter((n) => n.key !== key);
    if (gone && gone.tool === "APPROVAL") {
      // actions that hung on it become flow-wide instead of pointing at nothing
      next = next.map((n) =>
        n.attachKey === key
          ? { ...n, attachKey: "", when: n.when === "AFTER_REJECT" ? ("ANY_REJECT" as WhenId) : ("ANY_APPROVE" as WhenId) }
          : n
      );
    }
    if (gone && gone.tool === "START") {
      next = next.map((n) => (n.when === "ON_SUBMIT" ? { ...n, when: "ANY_APPROVE" as WhenId } : n));
    }
    if (selected === key) setSelected(null);
    commit(next);
  };

  const duplicateNode = (key: string) => {
    const i = nodes.findIndex((n) => n.key === key);
    if (i < 0) return;
    if (nodes[i].tool === "START") return;
    const copy = cloneNode(nodes[i], { name: `${nodes[i].name || toolMeta(nodes[i].tool).label} (copy)` });
    const next = [...nodes];
    next.splice(i + 1, 0, copy);
    commit(next);
    setSelected(copy.key);
  };

  const moveWithin = (key: string, dir: -1 | 1) => {
    const n = nodes.find((x) => x.key === key);
    if (!n) return;
    const att = attachment(nodes, n);
    const siblings = att ? slotChildren(nodes, att.parentId, att.slot) : mainLine;
    const si = siblings.indexOf(n);
    const ti = si + dir;
    if (ti < 0 || ti >= siblings.length) return;
    const target = siblings[ti];
    const next = [...nodes];
    const a = next.indexOf(n);
    const b = next.indexOf(target);
    next[a] = target;
    next[b] = n;
    commit(next);
  };

  const detach = (key: string) =>
    commit(nodes.map((n) => (n.key === key ? { ...n, when: n.when === "AFTER_REJECT" ? ("ANY_REJECT" as WhenId) : ("ANY_APPROVE" as WhenId), attachKey: "" } : n)));

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    setNodes((cur) => {
      future.current = [cur, ...future.current.slice(0, 49)];
      return prev;
    });
    setHistTick((t) => t + 1);
  }, []);

  const redo = useCallback(() => {
    const [next, ...rest] = future.current;
    if (!next) return;
    future.current = rest;
    setNodes((cur) => {
      past.current = [...past.current.slice(-49), cur];
      return next;
    });
    setHistTick((t) => t + 1);
  }, []);

  const applyRecipe = (id: string) => {
    const r = RECIPES.find((x) => x.id === id);
    if (!r) return;
    const built: FlowNode[] = [];
    let lastApproval = "";
    for (const spec of r.build()) {
      // only the tool and which port it belongs to — names, priorities and policies stay unset
      const n = newNode(spec.tool, spec.when ? { when: spec.when } : {});
      if (n.tool === "APPROVAL") lastApproval = n.key;
      if (isActionTool(n.tool) && n.when.startsWith("AFTER_") && !n.attachKey) n.attachKey = lastApproval;
      built.push(n);
    }
    // approval nodes anchor the chain; anything attached in the recipe follows its node
    const ordered: FlowNode[] = [];
    for (const n of built) {
      if (isActionTool(n.tool) && n.attachKey && n.when !== "AFTER_DECISION") {
        const i = ordered.findIndex((x) => x.key === n.attachKey);
        if (i >= 0) {
          const isReject = n.when === "AFTER_REJECT";
          const lastIdx = ordered.reduce((acc, x, xi) => (x.attachKey === n.attachKey && (x.when === "AFTER_REJECT") === isReject ? xi : acc), i);
          ordered.splice(lastIdx + 1, 0, n);
          continue;
        }
      }
      ordered.push(n);
    }
    commit([...nodes, ...ordered]);
    setError("");
  };

  /* ------------------------------------------------------------ validation -- */

  const issues = useMemo<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    const push = (key: string | null, text: string) => {
      if (!key) return;
      out[key] = [...(out[key] ?? []), text];
    };
    if (!name.trim()) push(null, "name");
    nodes.forEach((n) => {
      if (n.condField !== "none") {
        const cErr = validateConditionInput(n.condField, n.condOp, n.condValue);
        if (cErr) push(n.key, cErr);
      }
      if (n.tool === "APPROVAL") {
        if (!n.approverType) push(n.key, "pick who decides for this node");
        if (n.approverType === "ROLE" && !n.targetRoleId) push(n.key, "choose a role");
        if (n.approverType === "GROUP" && !n.targetGroupId) push(n.key, "choose a group");
        if (n.approverType === "USER" && !n.targetUserId) push(n.key, "choose who approves");
        if (n.approveAction === "JUMP_TO_STEP") {
          if (!n.approveTargetKey) push(n.key, "choose where to jump");
          else if (n.approveTargetKey === n.key) push(n.key, "cannot jump to itself");
        }
      } else if (isActionTool(n.tool)) {
        if (!n.when) push(n.key, "nothing is picked for when it runs — choose it, or drop the node on a port");
        const needsParent = n.when === "AFTER_APPROVE" || n.when === "AFTER_REJECT" || n.when === "AFTER_DECISION";
        if (needsParent && !approvalNodes(nodes).some((a) => a.key === n.attachKey))
          push(n.key, "pick the approval node this runs after");
        if (n.tool === "SET_PRIORITY" && !n.priority) push(n.key, "pick a priority");
        if (n.tool === "SET_SLA" && !n.slaPolicyId) push(n.key, "choose an SLA policy");
        if (n.tool === "ASSIGN_TO_USER" && !n.userId) push(n.key, "choose the user to assign");
        if (n.tool === "JUMP_TO_STEP" && !n.jumpToStepKey) push(n.key, "choose the node to land on");
        if (n.tool === "SET_STATUS" && !SETTABLE_STATUSES.some((s) => s.value === n.status)) push(n.key, "choose a status");
        if (n.tool === "NOTIFY" && !n.notifyTargetType) push(n.key, "choose who to notify");
        if (n.tool === "NOTIFY") {
          if (n.notifyTargetType === "USER" && !n.notifyUserId) push(n.key, "choose the user to notify");
          if (n.notifyTargetType === "GROUP" && !n.notifyGroupId) push(n.key, "choose the group to notify");
          if (n.notifyTargetType === "ROLE" && !n.notifyRoleId) push(n.key, "choose the role to notify");
        }
      }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, name]);

  const issueList = useMemo(
    () =>
      Object.entries(issues).flatMap(([key, texts]) => texts.map((text) => ({ key, text }))).concat(
        !name.trim() ? [{ key: "", text: "Give the workflow a name" }] : []
      ),
    [issues, name]
  );

  const focusNode = (key?: string) => {
    if (!key) return;
    setNodes((prev) => prev.map((n) => (n.key === key ? { ...n, open: true } : n)));
    setSelected(key);
    document.getElementById(`node-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /* ----------------------------------------------------------------- save -- */

  async function save() {
    setError("");
    if (!name.trim()) {
      setError("Give the workflow a name first.");
      return;
    }
    if (issueList.length > 0) {
      setError(issueList[0].text);
      focusNode(issueList[0].key);
      return;
    }
    const built = nodesToApi(nodes, { slas, users });
    if (built.problems.length > 0) {
      setError(`“${built.problems[0].reason}” — fix the node before saving.`);
      focusNode(built.problems[0].key);
      return;
    }

    const body = { name: name.trim(), description: description.trim() || null, status, steps: built.steps, rules: built.rules };

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
          await fetch(`/api/form-templates/${tid}`, { method: "PATCH", headers: h, body: JSON.stringify({ wfDefinitionId: savedId }) });
      }
      for (const tid of Array.from(initialAssigned)) {
        if (!assigned.has(tid))
          await fetch(`/api/form-templates/${tid}`, { method: "PATCH", headers: h, body: JSON.stringify({ wfDefinitionId: null }) });
      }
      baseline.current = JSON.stringify({ name, description, status, nodes });
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

  /* ----------------------------------------------------------- shortcuts -- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName ?? "");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!ro && dirty) save();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        document.getElementById("wf-tool-search")?.focus();
        return;
      }
      if (e.key === "Escape") {
        setSelected(null);
        setHover(null);
        setDrag(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected && !ro) {
        e.preventDefault();
        removeNode(selected);
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ro, dirty, issueList, nodes, name, description, status, selected]);

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

  const ctx: NodeCtx = {
    nodes,
    roles,
    groups,
    users,
    slas,
    ro,
    selected,
    select: setSelected,
    patch,
    remove: removeNode,
    duplicate: duplicateNode,
    moveWithin,
    detach,
    issues,
    drag,
    hover,
    enter: setHover,
    leave: () => setHover(null),
    dropOnLine,
    dropInSlot,
    addToSlot,
    startToolDrag: (t) => setDrag({ kind: "new", tool: t }),
    startNodeDrag: (k) => setDrag({ kind: "move", key: k }),
    endDrag,
  };

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

  const endApprove = slotChildren(nodes, END_KEY, "approve");
  const endReject = slotChildren(nodes, END_KEY, "reject");

  return (
    <AppShell>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href="/workflows" className="icon-btn !h-7 !w-7" title="Back to workflows">
              <Icon name="arrow_back" className="text-[18px]" />
            </Link>
            <input
              className="min-w-0 flex-1 border-b border-transparent bg-transparent text-xl font-bold tracking-tight text-on-surface outline-none hover:border-surface-variant focus:border-primary"
              value={name}
              disabled={ro}
              placeholder="Untitled workflow"
              onChange={(e) => setName(e.target.value)}
            />
            <StatusBadge status={status} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 pl-9 text-[11px] text-outline">
            <input
              className="min-w-0 flex-1 border-none bg-transparent text-xs text-on-surface-variant outline-none placeholder:text-outline"
              value={description}
              disabled={ro}
              placeholder="What is this flow for? (optional)"
              onChange={(e) => setDescription(e.target.value)}
            />
            <span>{approvalNodes(nodes).length} approval node(s)</span>
            <span>{nodes.filter((n) => isActionTool(n.tool) && n.enabled).length} action(s)</span>
            {usage && (
              <span>
                {usage.templates} form(s) · {usage.liveRequests} live
              </span>
            )}
            <select className="input w-auto !py-0 text-[11px]" disabled={ro} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ACTIVE">Active</option>
              <option value="DRAFT">Draft</option>
            </select>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 lg:pt-4">
          <div className="flex items-center gap-0.5">
            <button type="button" onClick={undo} disabled={!history.canUndo || ro} className="icon-btn !h-7 !w-7" title="Undo structure (Ctrl+Z)">
              <Icon name="undo" className="text-[18px]" />
            </button>
            <button type="button" onClick={redo} disabled={!history.canRedo || ro} className="icon-btn !h-7 !w-7" title="Redo (Ctrl+Shift+Z)">
              <Icon name="redo" className="text-[18px]" />
            </button>
          </div>
          {savedAt && !dirty && <span className="text-[11px] text-outline">saved {savedAt}</span>}
          {dirty && <span className="badge bg-amber-100 text-on-secondary-fixed-variant">unsaved changes</span>}
          <button onClick={save} disabled={saving || ro || (!dirty && !isNew)} className="btn-primary">
            <Icon name="save" className="text-[18px]" />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded border border-error/25 bg-error-container/60 px-4 py-2 text-sm text-danger">
          <Icon name="error" className="mt-0.5 text-[18px]" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-3">
          <Palette
            ro={ro}
            drag={drag}
            onAppend={appendTool}
            startToolDrag={ctx.startToolDrag}
            endDrag={ctx.endDrag}
            onRecipe={applyRecipe}
          />
        </div>

        {/* canvas */}
        <div className="xl:col-span-6" onClick={() => ctx.select(null)}>
          <div className="mx-auto max-w-2xl">
            {mainLine.length === 0 && !drag && (
              <div className="card flex flex-col items-center gap-2 border-2 border-dashed border-surface-variant p-8 text-center">
                <Icon name="account_tree" className="text-[30px] text-outline" />
                <p className="text-sm font-semibold text-on-surface">Empty canvas</p>
                <p className="max-w-sm text-xs leading-relaxed text-on-surface-variant">
                  Drag any tool from the left, in any order. A flow does not have to start with an approver: it can
                  be only automations on submit, one decision, or nothing that approves at all.
                </p>
                <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                  {TOOLS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      disabled={ro}
                      onClick={() => appendTool(t.id)}
                      className="rounded-full border border-surface-variant px-2 py-1 text-[11px] text-on-surface-variant hover:border-primary hover:text-primary"
                    >
                      + {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mainLine.map((n, i) => (
              <div
                key={n.key}
                {...zoneProps(ctx, `line@${i}`, () => dropOnLine(n))}
                className={ctx.hover === `line@${i}` ? "rounded-lg ring-2 ring-primary/30" : ""}
              >
                <NodeCard n={n} ctx={ctx} depth={0} />
              </div>
            ))}

            <div
              {...zoneProps(ctx, "line@end", () => dropOnLine(null))}
              className={`flex min-h-[42px] items-center justify-center rounded-lg border border-dashed px-3 text-[11px] ${
                ctx.hover === "line@end" ? "border-primary bg-surface-container-low/60 text-primary" : "border-surface-variant text-outline"
              }`}
            >
              {drag ? "drop it here" : mainLine.length > 0 ? "drop a tool here to add it at the end" : ""}
            </div>

            {/* end-of-request ports — pointless until there is a decision to end on */}
            <div className={`mt-3 grid gap-2 sm:grid-cols-2 ${approvalNodes(nodes).length === 0 ? "hidden" : ""}`}>
              <Port title="If the request ends approved" tone="approve" icon="verified" parentKey={END_KEY} slot="approve" ctx={ctx} depth={0} />
              <Port title="If the request ends rejected" tone="reject" icon="block" parentKey={END_KEY} slot="reject" ctx={ctx} depth={0} />
            </div>
            {(endApprove.length > 0 || endReject.length > 0) && (
              <p className="mt-1 text-right text-[10px] text-outline">
                {endApprove.length + endReject.length} node(s) run after the final decision.
              </p>
            )}
          </div>
        </div>

        {/* rail */}
        <div className="space-y-3 xl:col-span-3">
          <div className="card p-3">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-outline">Flow</h3>
            {nodes.length === 0 ? (
              <p className="text-xs text-outline">Nothing runs yet.</p>
            ) : (
              <ol className="space-y-0.5">
                {mainLine.map((n) => {
                  const kids =
                    n.tool === "APPROVAL"
                      ? [...slotChildren(nodes, n.key, "approve"), ...slotChildren(nodes, n.key, "reject")]
                      : n.tool === "START"
                        ? slotChildren(nodes, n.key, "submit")
                        : [];
                  return (
                    <li key={n.key}>
                      <button
                        type="button"
                        onClick={() => focusNode(n.key)}
                        className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-surface-container-low"
                      >
                        <Icon name={toolMeta(n.tool).icon} className={`text-[14px] ${n.enabled ? "text-on-surface-variant" : "text-outline line-through"}`} />
                        <span className="min-w-0 flex-1 truncate text-on-surface">{n.name || toolMeta(n.tool).label}</span>
                        {n.condField !== "none" && <Icon name="if_while" className="text-[12px] text-amber-600" />}
                      </button>
                      {kids.length > 0 && (
                        <div className="ml-4 border-l border-surface-variant pl-2">
                          {kids.map((k) => (
                            <button
                              key={k.key}
                              type="button"
                              onClick={() => focusNode(k.key)}
                              className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] text-on-surface-variant hover:bg-surface-container-low"
                            >
                              <Icon name={toolMeta(k.tool).icon} className="text-[13px]" />
                              <span className="min-w-0 flex-1 truncate">{k.name || toolMeta(k.tool).label}</span>
                              <span className="shrink-0 text-[9px] text-outline">{k.when ? WHEN_META[k.when].short : "when?"}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
                {(endApprove.length > 0 || endReject.length > 0) && (
                  <li className="mt-1 border-t border-surface-variant/70 pt-1 text-[10px] uppercase tracking-wide text-outline">
                    on final decision
                  </li>
                )}
              </ol>
            )}
          </div>

          <div className={`card p-3 ${issueList.length > 0 ? "border-amber-300" : ""}`}>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-outline">
              <Icon name={issueList.length > 0 ? "fact_check" : "check_circle"} className={`text-[15px] ${issueList.length > 0 ? "text-amber-600" : "text-green-600"}`} />
              Readiness
            </h3>
            {issueList.length === 0 ? (
              <p className="text-xs text-tertiary">
                {approvalNodes(nodes).length === 0
                  ? "No approval node in this flow — requests skip straight to approved, and your submit / end-of-request automations still run."
                  : "Ready. Save to publish."}
              </p>
            ) : (
              <ul className="space-y-1">
                {issueList.map((x, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => focusNode(x.key)}
                      className="flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left text-xs text-on-surface-variant hover:bg-secondary-fixed"
                    >
                      <Icon name="error" className="mt-px shrink-0 text-[14px] text-amber-600" />
                      {x.text}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-3">
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

          <div className="card p-3 text-[11px] leading-relaxed text-outline">
            Nodes run in canvas order. Actions dropped on an approval&apos;s port fire right after that decision; the
            end-of-request ports fire once, after the final outcome. A Jump stops the rest of its group. Undo/redo
            (Ctrl+Z) covers structure, <kbd className="rounded border border-surface-variant px-1">/</kbd> searches
            tools, <kbd className="rounded border border-surface-variant px-1">⌘S</kbd> saves.
          </div>
        </div>
      </div>

      {ro && <p className="mt-4 text-center text-xs text-outline">Read-only view — you do not have workflow management.</p>}
    </AppShell>
  );
}
