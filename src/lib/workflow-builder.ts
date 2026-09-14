// Workflow canvas → API mapping, kept React-free so it can be unit-tested.
//
// The builder is a flat list of blocks the admin creates. Persisting it reuses
// the existing tables:
//   APPROVAL block           → WFSteps (StepOrder = index among approval blocks)
//   AUTOMATION block         → WFRules, whose ActionValue carries the action
//                              payload plus `fireOnStepOrder` — the approval block
//                              it hangs on (the nearest APPROVAL block above it)
// "Runs after" decides the trigger:
//   AFTER_STEP + approve     → ON_STEP_APPROVED   (fireOnStepOrder set)
//   AFTER_STEP + reject      → ON_STEP_REJECTED    (fireOnStepOrder set)
//   AFTER_STEP + both        → both rows, same payload
//   ANY_STEP                 → step triggers without a binding (flow-wide)
//   SUBMIT                   → ON_SUBMIT
//   FINAL_APPROVED/REJECTED  → ON_REQUEST_APPROVED / ON_REQUEST_REJECTED

import { parseStepCondition, buildStepCondition } from "./workflow-conditions";
import { parseRuleActionValue, RULE_ACTIONS, type RuleActionValue } from "./workflow-rules";

export type ActionKind = "SET_PRIORITY" | "SET_SLA" | "ASSIGN_TO_USER" | "NOTIFY" | "JUMP_TO_STEP";
export type BlockType = "APPROVAL" | "ACTION";
export type RunScope = "AFTER_STEP" | "ANY_STEP" | "SUBMIT" | "FINAL_APPROVED" | "FINAL_REJECTED";
export type Decision = "APPROVED" | "REJECTED" | "BOTH";

export interface Block {
  key: string;
  type: BlockType;
  name: string;
  open: boolean;
  /** WFStepID for approval blocks loaded from the DB */
  id?: string;

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

  // shared "only when"
  condField: string;
  condOp: string;
  condValue: string;

  // AUTOMATION
  enabled: boolean;
  scope: RunScope;
  decision: Decision;
  actionKind: ActionKind;
  priority: string;
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

/** minimal shapes the canvas needs from a saved workflow */
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

export function newBlock(type: BlockType, over: Partial<Block> = {}): Block {
  return {
    key: nextKey(type === "APPROVAL" ? "ap" : "ac"),
    type,
    name: "",
    open: true,
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
    enabled: true,
    scope: "AFTER_STEP",
    decision: "APPROVED",
    actionKind: "SET_PRIORITY",
    priority: "URGENT",
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

export function patchBy<T extends { key: string }>(list: T[], key: string, p: Partial<T>): T[] {
  return list.map((x) => (x.key === key ? { ...x, ...p } : x));
}

export function cloneBlock(b: Block, over: Partial<Block> = {}): Block {
  return { ...b, key: nextKey(b.type === "APPROVAL" ? "ap" : "ac"), id: undefined, ...over };
}

export function approvalBlocks(blocks: Block[]): Block[] {
  return blocks.filter((b) => b.type === "APPROVAL");
}

/** index of the approval block this position hangs on (-1 = nothing above it) */
export function boundApprovalIndex(blocks: Block[], i: number): number {
  let n = -1;
  for (let j = 0; j <= i; j++) if (blocks[j].type === "APPROVAL") n++;
  return n;
}

export function approvalNameAt(blocks: Block[], idx: number): string | null {
  if (idx < 0) return null;
  const b = approvalBlocks(blocks)[idx];
  return b ? b.name.trim() || `Block ${idx + 1}` : null;
}

function conditionOf(b: Block): { field: string; op: string; value: string } | null {
  return b.condField === "none" ? null : { field: b.condField, op: b.condOp, value: b.condValue.trim() };
}

function actionPayload(b: Block, blocks: Block[]): RuleActionValue {
  const out: RuleActionValue = {};
  if (b.actionKind === "SET_PRIORITY") out.priority = b.priority;
  if (b.actionKind === "SET_SLA") out.slaPolicyId = b.slaPolicyId;
  if (b.actionKind === "ASSIGN_TO_USER") out.userId = b.userId;
  if (b.actionKind === "NOTIFY") {
    out.notifyTargetType = b.notifyTargetType as NonNullable<RuleActionValue["notifyTargetType"]>;
    out.notifyTargetId =
      b.notifyTargetType === "USER"
        ? b.notifyUserId
        : b.notifyTargetType === "GROUP"
          ? b.notifyGroupId
          : b.notifyTargetType === "ROLE"
            ? b.notifyRoleId
            : "";
    if (b.notifyTitle.trim()) out.notifyTitle = b.notifyTitle.trim();
    if (b.notifyMessage.trim()) out.notifyMessage = b.notifyMessage.trim();
  }
  if (b.actionKind === "JUMP_TO_STEP") {
    out.jumpToStepOrder = Math.max(0, approvalBlocks(blocks).findIndex((x) => x.key === b.jumpToStepKey));
  }
  return out;
}

/** audit-trail label for the rule — admin override first, derived otherwise */
export function derivedRuleName(
  b: Block,
  blocks: Block[],
  opts: { slas?: SlaOption[]; users?: UserOption[] } = {}
): string {
  if (b.name.trim()) return b.name.trim().slice(0, 150);
  switch (b.actionKind) {
    case "SET_PRIORITY":
      return `Priority → ${b.priority}`;
    case "SET_SLA":
      return `SLA → ${opts.slas?.find((s) => s.id === b.slaPolicyId)?.name ?? "policy"}`;
    case "ASSIGN_TO_USER":
      return `Assign → ${opts.users?.find((u) => u.UserID === b.userId)?.Name ?? "user"}`;
    case "NOTIFY":
      return b.notifyTitle.trim() || "Notify people";
    case "JUMP_TO_STEP":
      return `Jump → ${approvalNameAt(blocks, approvalBlocks(blocks).findIndex((x) => x.key === b.jumpToStepKey)) ?? "block"}`;
  }
}

export interface BuiltWorkflow {
  steps: Record<string, unknown>[];
  rules: Record<string, unknown>[];
  /** blocks that could not be expressed (kept so the UI can warn) */
  skipped: { key: string; reason: string }[];
}

export function blocksToApi(
  blocks: Block[],
  opts: { slas?: SlaOption[]; users?: UserOption[] } = {}
): BuiltWorkflow {
  const approvals = approvalBlocks(blocks);
  const skipped: { key: string; reason: string }[] = [];

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
  const emit = (b: Block, trigger: string, fireOnStepOrder: number | undefined) => {
    const payload = actionPayload(b, blocks);
    if (typeof fireOnStepOrder === "number") payload.fireOnStepOrder = fireOnStepOrder;
    rules.push({
      name: derivedRuleName(b, blocks, opts),
      trigger,
      condition: conditionOf(b),
      action: b.actionKind,
      actionValue: payload,
      sortOrder: order++,
      isActive: b.enabled,
    });
  };

  blocks.forEach((b, i) => {
    // a paused block is still written (isActive=false) so it survives the save
    if (b.type !== "ACTION") return;
    if (b.scope === "SUBMIT") emit(b, "ON_SUBMIT", undefined);
    else if (b.scope === "FINAL_APPROVED") emit(b, "ON_REQUEST_APPROVED", undefined);
    else if (b.scope === "FINAL_REJECTED") emit(b, "ON_REQUEST_REJECTED", undefined);
    else if (b.scope === "ANY_STEP") {
      if (b.decision !== "REJECTED") emit(b, "ON_STEP_APPROVED", undefined);
      if (b.decision !== "APPROVED") emit(b, "ON_STEP_REJECTED", undefined);
    } else {
      const idx = boundApprovalIndex(blocks, i);
      if (idx < 0) {
        skipped.push({ key: b.key, reason: "no approval block above it" });
        return;
      }
      if (b.decision !== "REJECTED") emit(b, "ON_STEP_APPROVED", idx);
      if (b.decision !== "APPROVED") emit(b, "ON_STEP_REJECTED", idx);
    }
  });

  return { steps, rules, skipped };
}

/** same payload on both decisions = one "Both" block instead of two */
export function sameAction(a: Block, b: Block): boolean {
  return (
    a.actionKind === b.actionKind &&
    a.priority === b.priority &&
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

export function apiToBlocks(
  steps: BuilderStep[],
  rules: BuilderRule[],
  opts: { openAll?: boolean } = {}
): Block[] {
  const sorted = [...steps].sort((a, b) => a.StepOrder - b.StepOrder);
  const approvals = sorted.map((s) => {
    const cond = parseStepCondition(s.Condition);
    return newBlock("APPROVAL", {
      id: s.WFStepID,
      name: s.StepName,
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
      open: opts.openAll ?? sorted.length <= 3,
    });
  });
  sorted.forEach((s, i) => {
    const jumpIdx = sorted.findIndex((x) => x.WFStepID === s.ApproveTargetStepID);
    if (jumpIdx >= 0) approvals[i].approveTargetKey = approvals[jumpIdx].key;
  });

  const atStart: Block[] = []; // ON_SUBMIT — always above every block
  const atEnd: Block[] = []; // flow-wide + final-decision hooks — below the last approval
  const perStep = new Map<number, { approve: Block[]; reject: Block[] }>();

  const scopeForTrigger: Record<string, RunScope> = {
    ON_SUBMIT: "SUBMIT",
    ON_REQUEST_APPROVED: "FINAL_APPROVED",
    ON_REQUEST_REJECTED: "FINAL_REJECTED",
  };

  const toBlock = (r: BuilderRule): Block => {
    const v = parseRuleActionValue(r.ActionValue ?? null);
    const cond = parseStepCondition(r.Condition);
    const jumpIdx = typeof v.jumpToStepOrder === "number" ? v.jumpToStepOrder : -1;
    const base: Partial<Block> = {
      name: r.Name,
      type: "ACTION",
      open: false,
      enabled: r.IsActive !== false, // a row we cannot read the flag on stays live
      actionKind: (RULE_ACTIONS.some((a) => a.value === r.Action) ? r.Action : "NOTIFY") as ActionKind,
      priority: v.priority ?? "URGENT",
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
    };
    return newBlock("ACTION", base);
  };

  for (const r of rules) {
    const v = parseRuleActionValue(r.ActionValue ?? null);
    const block = toBlock(r);
    const scoped = scopeForTrigger[r.Trigger];
    if (scoped) {
      block.scope = scoped;
      (scoped === "SUBMIT" ? atStart : atEnd).push(block);
      continue;
    }
    const isReject = r.Trigger === "ON_STEP_REJECTED";
    if (typeof v.fireOnStepOrder !== "number") {
      block.scope = "ANY_STEP";
      block.decision = isReject ? "REJECTED" : "APPROVED";
      atEnd.push(block);
    } else {
      block.scope = "AFTER_STEP";
      block.decision = isReject ? "REJECTED" : "APPROVED";
      const bucket = perStep.get(v.fireOnStepOrder) ?? { approve: [], reject: [] };
      bucket[isReject ? "reject" : "approve"].push(block);
      perStep.set(v.fireOnStepOrder, bucket);
    }
  }

  const out: Block[] = [...atStart];
  sorted.forEach((_s, i) => {
    out.push(approvals[i]);
    const bucket = perStep.get(i);
    if (!bucket) return;
    const pair = bucket.approve.find((a) => bucket.reject.some((x) => sameAction(a, x)));
    if (pair) {
      out.push({ ...pair, decision: "BOTH" });
      out.push(...bucket.approve.filter((a) => a !== pair), ...bucket.reject.filter((x) => !sameAction(x, pair)));
    } else {
      out.push(...bucket.approve, ...bucket.reject);
    }
  });
  out.push(...atEnd);

  // a step-bound block that ended up above every approval cannot be expressed
  out.forEach((b, i) => {
    if (b.type === "ACTION" && b.scope === "AFTER_STEP" && boundApprovalIndex(out, i) < 0) b.scope = "ANY_STEP";
  });
  return out;
}

/** round-trip guard used by tests: the condition string the API will store */
export function conditionJsonFor(b: Block): string | null {
  const c = conditionOf(b);
  return c
    ? buildStepCondition(
        c.field as "totalValue" | "itemCount" | "priority",
        c.op as ">=",
        c.value
      )
    : null;
}
