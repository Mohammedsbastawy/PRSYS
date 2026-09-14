// Workflow canvas data model + API mapping. React-free so it can be unit-tested.
//
// The canvas is a flat list of nodes the admin drops from the tools palette.
// Nothing is pre-created: not a start node, not an approval, not a close step.
// Persistence reuses the existing tables (no migration):
//
//   APPROVAL node            → WFSteps  (StepOrder = position among approval nodes)
//   action node              → WFRules  (ActionValue carries the payload + fireOnStepOrder)
//   START node               → nothing on its own; it is the drop target for ON_SUBMIT rules
//
// A node's `when` decides its trigger, and `attachKey` which approval it hangs on:
//
//   ON_SUBMIT       → ON_SUBMIT
//   AFTER_APPROVE   → ON_STEP_APPROVED   + fireOnStepOrder = index of attachKey
//   AFTER_REJECT    → ON_STEP_REJECTED   + fireOnStepOrder = index of attachKey
//   AFTER_DECISION  → both of the above, same payload
//   ANY_APPROVE     → ON_STEP_APPROVED   (no binding: fires after every approval)
//   ANY_REJECT      → ON_STEP_REJECTED   (no binding)
//   FINAL_APPROVE   → ON_REQUEST_APPROVED
//   FINAL_REJECT    → ON_REQUEST_REJECTED

import { parseStepCondition, buildStepCondition } from "./workflow-conditions";
import { parseRuleActionValue, RULE_ACTIONS, type RuleActionValue } from "./workflow-rules";

export type ToolId =
  | "START"
  | "APPROVAL"
  | "SET_PRIORITY"
  | "SET_STATUS"
  | "SET_SLA"
  | "ASSIGN_TO_USER"
  | "NOTIFY"
  | "JUMP_TO_STEP";

export type WhenId =
  | "ON_SUBMIT"
  | "AFTER_APPROVE"
  | "AFTER_REJECT"
  | "AFTER_DECISION"
  | "ANY_APPROVE"
  | "ANY_REJECT"
  | "FINAL_APPROVE"
  | "FINAL_REJECT";

/** which drop zone of a parent node a `when` belongs to */
export type SlotId = "submit" | "approve" | "reject" | "decision" | "end" | "flow";

export interface FlowNode {
  key: string;
  tool: ToolId;
  name: string;
  open: boolean;
  /** WFStepID for approval nodes loaded from the DB */
  id?: string;
  /** action nodes: paused nodes are stored inactive instead of being deleted */
  enabled: boolean;

  when: WhenId;
  /** approval node this action hangs on (AFTER_* only) */
  attachKey: string;

  // APPROVAL
  approverType: string;
  targetUserId: string;
  targetGroupId: string;
  targetRoleId: string;
  approvalMode: string;
  commentPolicy: string;
  dueDays: string;
  rejectAction: string;
  approveAction: string;
  approveTargetKey: string;

  // "only when" gate — available on every node, approval or action
  condField: string;
  condOp: string;
  condValue: string;

  // actions
  priority: string;
  status: string;
  slaPolicyId: string;
  userId: string;
  notifyTargetType: string;
  notifyUserId: string;
  notifyGroupId: string;
  notifyRoleId: string;
  notifyTitle: string;
  notifyMessage: string;
  jumpToStepKey: string;
}

/** what the API returns for a saved workflow, narrowed to what the canvas needs */
export interface BuilderStep {
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
export interface BuilderRule {
  RuleID: string;
  Name: string;
  Trigger: string;
  Condition: string | null;
  Action: string;
  ActionValue: string | null;
  IsActive: boolean;
}
export interface SlaOption {
  id: string;
  name: string;
}
export interface UserOption {
  UserID: string;
  Name: string;
}

let seq = 0;
export function nextKey(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export const ACTION_TOOLS: ToolId[] = ["SET_PRIORITY", "SET_STATUS", "SET_SLA", "ASSIGN_TO_USER", "NOTIFY", "JUMP_TO_STEP"];

export function isActionTool(t: ToolId): boolean {
  return ACTION_TOOLS.includes(t);
}

export function newNode(tool: ToolId, over: Partial<FlowNode> = {}): FlowNode {
  return {
    key: nextKey(tool.toLowerCase()),
    tool,
    name: "",
    open: true,
    enabled: true,
    when: tool === "APPROVAL" || tool === "START" ? "ON_SUBMIT" : "AFTER_APPROVE",
    attachKey: "",
    approverType: "DEPARTMENT_MANAGER",
    targetUserId: "",
    targetGroupId: "",
    targetRoleId: "",
    approvalMode: "ANY_ONE",
    commentPolicy: "OPTIONAL",
    dueDays: "",
    rejectAction: "RETURN_TO_REQUESTER",
    approveAction: "CONTINUE",
    approveTargetKey: "",
    condField: "none",
    condOp: ">=",
    condValue: "",
    priority: "URGENT",
    status: "COMPLETED",
    slaPolicyId: "",
    userId: "",
    notifyTargetType: "REQUESTER",
    notifyUserId: "",
    notifyGroupId: "",
    notifyRoleId: "",
    notifyTitle: "",
    notifyMessage: "",
    jumpToStepKey: "",
    ...over,
  };
}

export function patchNode<T extends { key: string }>(list: T[], key: string, p: Partial<T>): T[] {
  return list.map((x) => (x.key === key ? { ...x, ...p } : x));
}

export function cloneNode(n: FlowNode, over: Partial<FlowNode> = {}): FlowNode {
  return { ...n, key: nextKey(n.tool.toLowerCase()), id: undefined, ...over };
}

export function approvalNodes(nodes: FlowNode[]): FlowNode[] {
  return nodes.filter((n) => n.tool === "APPROVAL");
}

export function startNode(nodes: FlowNode[]): FlowNode | null {
  return nodes.find((n) => n.tool === "START") ?? null;
}

export function slotOf(n: FlowNode): SlotId {
  if (n.tool === "APPROVAL") return "flow";
  if (n.tool === "START") return "flow";
  switch (n.when) {
    case "ON_SUBMIT":
      return "submit";
    case "AFTER_APPROVE":
      return "approve";
    case "AFTER_REJECT":
      return "reject";
    case "AFTER_DECISION":
      return "decision";
    case "FINAL_APPROVE":
    case "FINAL_REJECT":
      return "end";
    default:
      return "flow";
  }
}

/** synthetic parent that owns the two "when the request ends" drop ports */
export const END_KEY = "__end__";

/** where a node renders: attached to an approval/START node, or on the main line */
export function attachment(nodes: FlowNode[], n: FlowNode): { parentId: string; slot: SlotId } | null {
  if (!isActionTool(n.tool)) return null;
  if (n.when === "ON_SUBMIT" && startNode(nodes)) return { parentId: startNode(nodes)!.key, slot: "submit" };
  if (n.when === "FINAL_APPROVE") return { parentId: END_KEY, slot: "approve" };
  if (n.when === "FINAL_REJECT") return { parentId: END_KEY, slot: "reject" };
  if (n.when === "AFTER_APPROVE" || n.when === "AFTER_REJECT" || n.when === "AFTER_DECISION") {
    const parent = nodes.find((p) => p.key === n.attachKey && p.tool === "APPROVAL");
    if (parent) return { parentId: parent.key, slot: slotOf(n) };
  }
  return null;
}

export function slotChildren(nodes: FlowNode[], parentKey: string, slot: SlotId): FlowNode[] {
  return nodes.filter((n) => {
    const a = attachment(nodes, n);
    return a !== null && a.parentId === parentKey && a.slot === slot;
  });
}

/** index of the approval node an action is bound to, or -1 */
export function boundApprovalIndex(nodes: FlowNode[], n: FlowNode): number {
  if (n.attachKey) {
    const i = approvalNodes(nodes).findIndex((a) => a.key === n.attachKey);
    if (i >= 0) return i;
  }
  return -1;
}

export function approvalNameAt(nodes: FlowNode[], idx: number): string | null {
  if (idx < 0) return null;
  const a = approvalNodes(nodes)[idx];
  return a ? a.name.trim() || `Approval ${idx + 1}` : null;
}

export function approvalLabel(nodes: FlowNode[], key: string): string | null {
  return approvalNameAt(nodes, approvalNodes(nodes).findIndex((a) => a.key === key));
}

function conditionOf(n: FlowNode): { field: string; op: string; value: string } | null {
  return n.condField === "none" ? null : { field: n.condField, op: n.condOp, value: n.condValue.trim() };
}

function actionPayload(n: FlowNode, nodes: FlowNode[]): RuleActionValue {
  const out: RuleActionValue = {};
  switch (n.tool) {
    case "SET_PRIORITY":
      out.priority = n.priority;
      break;
    case "SET_STATUS":
      out.status = n.status;
      break;
    case "SET_SLA":
      out.slaPolicyId = n.slaPolicyId;
      break;
    case "ASSIGN_TO_USER":
      out.userId = n.userId;
      break;
    case "NOTIFY":
      out.notifyTargetType = n.notifyTargetType as NonNullable<RuleActionValue["notifyTargetType"]>;
      out.notifyTargetId =
        n.notifyTargetType === "USER"
          ? n.notifyUserId
          : n.notifyTargetType === "GROUP"
            ? n.notifyGroupId
            : n.notifyTargetType === "ROLE"
              ? n.notifyRoleId
              : "";
      if (n.notifyTitle.trim()) out.notifyTitle = n.notifyTitle.trim();
      if (n.notifyMessage.trim()) out.notifyMessage = n.notifyMessage.trim();
      break;
    case "JUMP_TO_STEP":
      out.jumpToStepOrder = Math.max(0, approvalNodes(nodes).findIndex((a) => a.key === n.jumpToStepKey));
      break;
    default:
      break;
  }
  return out;
}

/** audit-trail label for the rule — the admin's own text wins, otherwise derived */
export function derivedNodeName(
  n: FlowNode,
  nodes: FlowNode[],
  opts: { slas?: SlaOption[]; users?: UserOption[] } = {}
): string {
  if (n.name.trim()) return n.name.trim().slice(0, 150);
  switch (n.tool) {
    case "SET_PRIORITY":
      return `Priority → ${n.priority}`;
    case "SET_STATUS":
      return `Status → ${n.status.replace(/_/g, " ").toLowerCase()}`;
    case "SET_SLA":
      return `SLA → ${opts.slas?.find((s) => s.id === n.slaPolicyId)?.name ?? "policy"}`;
    case "ASSIGN_TO_USER":
      return `Assign → ${opts.users?.find((u) => u.UserID === n.userId)?.Name ?? "user"}`;
    case "NOTIFY":
      return n.notifyTitle.trim() || "Notify people";
    case "JUMP_TO_STEP":
      return `Jump → ${approvalLabel(nodes, n.jumpToStepKey) ?? "block"}`;
    default:
      return "Workflow node";
  }
}

export interface BuiltWorkflow {
  steps: Record<string, unknown>[];
  rules: Record<string, unknown>[];
  /** nodes that cannot be expressed against the current schema — surfaced, never silently dropped */
  problems: { key: string; reason: string }[];
}

export function nodesToApi(
  nodes: FlowNode[],
  opts: { slas?: SlaOption[]; users?: UserOption[] } = {}
): BuiltWorkflow {
  const approvals = approvalNodes(nodes);
  const problems: { key: string; reason: string }[] = [];

  const steps = approvals.map((s, i) => ({
    ...(s.id ? { id: s.id } : {}),
    stepName: s.name.trim(),
    stepOrder: i,
    approverType: s.approverType,
    targetUserId: s.approverType === "USER" ? s.targetUserId || null : null,
    targetGroupId: s.approverType === "GROUP" ? s.targetGroupId || null : null,
    targetRoleId: s.approverType === "ROLE" ? s.targetRoleId || null : null,
    approvalMode: s.approvalMode,
    rejectAction: s.rejectAction,
    approveAction: s.approveAction,
    approveTargetIndex:
      s.approveAction === "JUMP_TO_STEP" ? approvals.findIndex((x) => x.key === s.approveTargetKey) + 1 : null,
    condition: conditionOf(s),
    dueDays: s.dueDays.trim() === "" ? null : Number(s.dueDays),
    commentPolicy: s.commentPolicy,
  }));

  const rules: Record<string, unknown>[] = [];
  let order = 0;
  const emit = (n: FlowNode, trigger: string, fireOnStepOrder: number | undefined) => {
    const payload = actionPayload(n, nodes);
    if (typeof fireOnStepOrder === "number") payload.fireOnStepOrder = fireOnStepOrder;
    rules.push({
      name: derivedNodeName(n, nodes, opts),
      trigger,
      condition: conditionOf(n),
      action: n.tool,
      actionValue: payload,
      sortOrder: order++,
      isActive: n.enabled,
    });
  };

  for (const n of nodes) {
    if (!isActionTool(n.tool)) continue;
    const needsParent =
      n.when === "AFTER_APPROVE" || n.when === "AFTER_REJECT" || n.when === "AFTER_DECISION";
    const idx = needsParent ? approvalNodes(nodes).findIndex((a) => a.key === n.attachKey) : -1;
    if (needsParent && idx < 0) {
      problems.push({ key: n.key, reason: "it is set to follow an approval decision, but no approval node is selected" });
      continue;
    }
    switch (n.when) {
      case "ON_SUBMIT":
        emit(n, "ON_SUBMIT", undefined);
        break;
      case "FINAL_APPROVE":
        emit(n, "ON_REQUEST_APPROVED", undefined);
        break;
      case "FINAL_REJECT":
        emit(n, "ON_REQUEST_REJECTED", undefined);
        break;
      case "ANY_APPROVE":
        emit(n, "ON_STEP_APPROVED", undefined);
        break;
      case "ANY_REJECT":
        emit(n, "ON_STEP_REJECTED", undefined);
        break;
      case "AFTER_DECISION":
        emit(n, "ON_STEP_APPROVED", idx);
        emit(n, "ON_STEP_REJECTED", idx);
        break;
      case "AFTER_APPROVE":
        emit(n, "ON_STEP_APPROVED", idx);
        break;
      case "AFTER_REJECT":
        emit(n, "ON_STEP_REJECTED", idx);
        break;
    }
  }

  return { steps, rules, problems };
}

/** two rules written identically on both outcomes = one "decision" node, not two */
export function sameAction(a: FlowNode, b: FlowNode): boolean {
  return (
    a.tool === b.tool &&
    a.priority === b.priority &&
    a.status === b.status &&
    a.slaPolicyId === b.slaPolicyId &&
    a.userId === b.userId &&
    a.notifyTargetType === b.notifyTargetType &&
    a.notifyUserId === b.notifyUserId &&
    a.notifyGroupId === b.notifyGroupId &&
    a.notifyRoleId === b.notifyRoleId &&
    a.notifyTitle === b.notifyTitle &&
    a.notifyMessage === b.notifyMessage &&
    a.jumpToStepKey === b.jumpToStepKey &&
    a.condField === b.condField &&
    a.condOp === b.condOp &&
    a.condValue === b.condValue
  );
}

const WHEN_FOR_TRIGGER: Record<string, WhenId> = {
  ON_SUBMIT: "ON_SUBMIT",
  ON_REQUEST_APPROVED: "FINAL_APPROVE",
  ON_REQUEST_REJECTED: "FINAL_REJECT",
};

export function apiToNodes(nodes0: BuilderStep[], rules: BuilderRule[], opts: { openAll?: boolean } = {}): FlowNode[] {
  const sorted = [...nodes0].sort((a, b) => a.StepOrder - b.StepOrder);
  const approvals = sorted.map((s) => {
    const cond = parseStepCondition(s.Condition);
    return newNode("APPROVAL", {
      id: s.WFStepID,
      name: s.StepName,
      open: opts.openAll ?? sorted.length <= 2,
      approverType: s.ApproverType,
      targetUserId: s.TargetUserID ?? "",
      targetGroupId: s.TargetGroupID ?? "",
      targetRoleId: s.TargetRoleID ?? "",
      approvalMode: s.ApprovalMode ?? "ANY_ONE",
      rejectAction: s.RejectAction ?? "REJECT_COMPLETELY",
      approveAction: s.ApproveAction ?? "CONTINUE",
      commentPolicy: s.CommentPolicy ?? "OPTIONAL",
      dueDays: s.DueDays != null ? String(s.DueDays) : "",
      condField: cond?.field ?? "none",
      condOp: cond?.op ?? ">=",
      condValue: cond?.value ?? "",
    });
  });
  sorted.forEach((s, i) => {
    const jumpIdx = sorted.findIndex((x) => x.WFStepID === s.ApproveTargetStepID);
    if (jumpIdx >= 0) approvals[i].approveTargetKey = approvals[jumpIdx].key;
  });

  const toNode = (r: BuilderRule): FlowNode => {
    const v = parseRuleActionValue(r.ActionValue ?? null);
    const cond = parseStepCondition(r.Condition);
    const jumpIdx = typeof v.jumpToStepOrder === "number" ? v.jumpToStepOrder : -1;
    return newNode((RULE_ACTIONS.some((a) => a.value === r.Action) ? r.Action : "NOTIFY") as ToolId, {
      name: r.Name,
      open: false,
      enabled: r.IsActive !== false,
      priority: v.priority ?? "URGENT",
      status: v.status ?? "COMPLETED",
      slaPolicyId: v.slaPolicyId ?? "",
      userId: v.userId ?? "",
      notifyTargetType: v.notifyTargetType ?? "REQUESTER",
      notifyUserId: v.notifyTargetType === "USER" ? v.notifyTargetId ?? "" : "",
      notifyGroupId: v.notifyTargetType === "GROUP" ? v.notifyTargetId ?? "" : "",
      notifyRoleId: v.notifyTargetType === "ROLE" ? v.notifyTargetId ?? "" : "",
      notifyTitle: v.notifyTitle ?? "",
      notifyMessage: v.notifyMessage ?? "",
      jumpToStepKey: jumpIdx >= 0 ? approvals[jumpIdx]?.key ?? "" : "",
      condField: cond?.field ?? "none",
      condOp: cond?.op ?? ">=",
      condValue: cond?.value ?? "",
    });
  };

  const loose: FlowNode[] = []; // main-line nodes (submit hook, flow-wide, end-of-request)
  const perStep = new Map<number, { approve: FlowNode[]; reject: FlowNode[] }>();
  let hasSubmitRule = false;

  for (const r of rules) {
    const v = parseRuleActionValue(r.ActionValue ?? null);
    const node = toNode(r);
    const fixed = WHEN_FOR_TRIGGER[r.Trigger];
    if (fixed) {
      node.when = fixed;
      if (fixed === "ON_SUBMIT") hasSubmitRule = true;
      loose.push(node);
      continue;
    }
    const isReject = r.Trigger === "ON_STEP_REJECTED";
    if (typeof v.fireOnStepOrder !== "number") {
      node.when = isReject ? "ANY_REJECT" : "ANY_APPROVE";
      loose.push(node);
    } else {
      node.when = isReject ? "AFTER_REJECT" : "AFTER_APPROVE";
      node.attachKey = approvals[v.fireOnStepOrder]?.key ?? "";
      const bucket = perStep.get(v.fireOnStepOrder) ?? { approve: [], reject: [] };
      bucket[isReject ? "reject" : "approve"].push(node);
      perStep.set(v.fireOnStepOrder, bucket);
    }
  }

  // rebuild the flat list: an approval node is followed by the nodes hanging on it,
  // so the array order is both the reading order and the rule execution order
  const out: FlowNode[] = [];
  approvals.forEach((a, i) => {
    out.push(a);
    const bucket = perStep.get(i);
    if (!bucket) return;
    const pair = bucket.approve.find((x) => bucket.reject.some((y) => sameAction(x, y)));
    if (pair) {
      out.push({ ...pair, when: "AFTER_DECISION", attachKey: a.key });
      const rest = [...bucket.approve.filter((x) => x !== pair), ...bucket.reject.filter((x) => !sameAction(x, pair))];
      for (const x of rest) out.push({ ...x, attachKey: a.key, when: x.when });
    } else {
      for (const x of [...bucket.approve, ...bucket.reject]) out.push({ ...x, attachKey: a.key });
    }
  });
  for (const n of loose) out.push(n);
  if (hasSubmitRule) out.unshift(newNode("START", { open: false }));

  // submit-time nodes belong above the approvals in the canvas — note the when field
  // is meaningless on approval/START nodes, so only action nodes may be collected here
  const start = out.find((n) => n.tool === "START");
  const isSubmitHook = (n: FlowNode) => isActionTool(n.tool) && n.when === "ON_SUBMIT";
  const submits = out.filter(isSubmitHook);
  const rest = out.filter((n) => n.tool !== "START" && !isSubmitHook(n));
  const ordered = start ? [start, ...submits, ...rest] : [...submits, ...rest];

  // an action that lost its approval node falls back to flow-wide instead of vanishing
  const alive = new Set(approvalNodes(ordered).map((a) => a.key));
  for (const n of ordered) {
    if (!isActionTool(n.tool)) continue;
    if ((n.when === "AFTER_APPROVE" || n.when === "AFTER_REJECT" || n.when === "AFTER_DECISION") && !alive.has(n.attachKey)) {
      n.when = n.when === "AFTER_REJECT" ? "ANY_REJECT" : "ANY_APPROVE";
      n.attachKey = "";
    }
  }
  return ordered;
}

export function conditionJsonFor(n: FlowNode): string | null {
  const c = conditionOf(n);
  return c
    ? buildStepCondition(c.field as "totalValue" | "itemCount" | "priority", c.op as ">=", c.value)
    : null;
}
