// The visual canvas graph model (n8n-style) + its mapping to the engine.
//
// The canvas is a directed graph:
//
//   START ──▶ [actions…] ──▶ APPROVAL ──approve──▶ [actions…] ──▶ …
//                                      │
//                                      └──reject──▶ [actions…] ──▶ …
//
// * Every node except START has exactly ONE input edge — that edge IS its
//   trigger (after submit / after this approval approves / after it rejects).
// * A branch may simply END at any node — there are no special "end" nodes.
//   The final outcome is a plain ticket status: the engine sets the request
//   to APPROVED / REJECTED by itself when the last step completes or is
//   rejected, and fires the matching final rules.
// * Nothing is stored twice: Steps + Rules stay the engine source of truth,
//   and the saved graph JSON (WFDefinitions.CanvasJson) carries layout + wiring.

import {
  type BuilderRule,
  type BuilderStep,
  type FlowNode,
  type ToolId,
  actionPayload,
  conditionOf,
  derivedNodeName,
  derivedStepName,
  nextKey,
  newNode,
} from "./workflow-builder";
import { parseStepCondition, validateConditionInput } from "./workflow-conditions";
import { RULE_ACTIONS, parseRuleActionValue } from "./workflow-rules";
import { RECIPES, SETTABLE_STATUSES } from "./workflow-tools";

export type GNodeKind = "start" | "approval" | "action";

export interface GNode {
  id: string;
  kind: GNodeKind;
  position: { x: number; y: number };
  /** the node's settings — data.key always equals the node id */
  data: FlowNode;
}
export interface GEdge {
  id: string;
  source: string;
  /** "out" (start/actions) · "approve" · "reject" */
  sourceHandle?: string;
  target: string;
}
export interface Graph {
  nodes: GNode[];
  edges: GEdge[];
}
export type SourceHandle = "out" | "approve" | "reject";

/** grid step used by autoLayout + recipe appends (nodes are ~240px wide) */
const CELL = { x: 280, y: 240 };

export const GRAPH_VERSION = 1;
export const ACTION_NODE_TOOLS: ToolId[] = [
  "SET_PRIORITY",
  "SET_STATUS",
  "SET_SLA",
  "ASSIGN_TO_USER",
  "ASSIGN_TO_GROUP",
  "ASSIGN_TO_DEPARTMENT",
  "NOTIFY",
  "JUMP_TO_STEP",
];

/* ------------------------------------------------------------- construction -- */

export function makeNode(kind: GNodeKind, tool: ToolId, position = { x: 0, y: 0 }): GNode {
  const t = kind === "start" ? "START" : kind === "approval" ? "APPROVAL" : kind === "action" ? tool : "NOTIFY";
  const id = nextKey(kind === "action" ? t.toLowerCase() : kind.replace("_", "-"));
  return { id, kind, position, data: { ...newNode(t), key: id, open: false } };
}

export function nodeById(g: Graph, id: string): GNode | null {
  return g.nodes.find((n) => n.id === id) ?? null;
}
export function outEdges(g: Graph, id: string): GEdge[] {
  return g.edges.filter((e) => e.source === id);
}
export function inEdges(g: Graph, id: string): GEdge[] {
  return g.edges.filter((e) => e.target === id);
}
/** walk `from` forward; returns every node reachable (from itself on) */
function reachableFrom(g: Graph, from: string): Set<string> {
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of g.edges) if (e.source === cur && !seen.has(e.target)) {
      seen.add(e.target);
      stack.push(e.target);
    }
  }
  return seen;
}

/**
 * Add a connection with n8n-style replacement rules:
 *  - one edge per source handle (a second wire from the same handle replaces it)
 *  - one input per node (a second wire into a node replaces it)
 *  - no self wires, no cycles, START can't be wired into
 */
export function connectGraph(g: Graph, conn: { source: string; sourceHandle?: string; target: string }): Graph {
  const { source, target } = conn;
  if (!source || !target || source === target) return g;
  const src = nodeById(g, source);
  const tgt = nodeById(g, target);
  if (!src || !tgt || tgt.kind === "start") return g;
  const handle = conn.sourceHandle ?? "out";
  if (src.kind === "approval" && handle !== "approve" && handle !== "reject") return g;
  // cycle: source must not be reachable from target
  if (reachableFrom(g, target).has(source)) return g;
  const edges = g.edges
    .filter((e) => !(e.source === source && (e.sourceHandle ?? "out") === handle))
    .filter((e) => e.target !== target);
  edges.push({ id: nextKey("edge"), source, sourceHandle: handle, target });
  return { nodes: g.nodes, edges };
}

/** delete a node and everything wired to/from it (START is protected) */
/** human reason a connection is refused (null = it is allowed) */
export function connectProblem(g: Graph, conn: { source: string; sourceHandle?: string; target: string }): string | null {
  const src = nodeById(g, conn.source);
  const tgt = nodeById(g, conn.target);
  if (!src || !tgt) return null;
  if (conn.source === conn.target) return "a node cannot connect to itself";
  if (tgt.kind === "start") return "nothing can feed into the start";
  const handle = conn.sourceHandle ?? "out";
  if (src.kind === "approval" && handle !== "approve" && handle !== "reject") return "use the approval's approved / rejected ports";
  if (reachableFrom(g, conn.target).has(conn.source)) return "that would create a loop — a flow must always end";
  return null;
}

export function removeNodeGraph(g: Graph, id: string): Graph {
  const n = nodeById(g, id);
  if (!n || n.kind === "start") return g;
  return {
    nodes: g.nodes.filter((x) => x.id !== id),
    edges: g.edges.filter((e) => e.source !== id && e.target !== id),
  };
}

/* ---------------------------------------------------------- traversal core -- */

interface TriggerCtx {
  trigger: "ON_SUBMIT" | "ON_STEP_APPROVED" | "ON_STEP_REJECTED";
  stepIndex: number | null;
}

/** BFS from START, in edge order — the visit order IS the execution order */
export function walk(g: Graph): { order: GNode[]; visited: Set<string> } {
  const start = g.nodes.find((n) => n.kind === "start");
  const order: GNode[] = [];
  const visited = new Set<string>();
  if (!start) return { order, visited };
  const queue: GNode[] = [start];
  while (queue.length) {
    const n = queue.shift()!;
    if (visited.has(n.id)) continue;
    visited.add(n.id);
    order.push(n);
    for (const e of g.edges) if (e.source === n.id) {
      const t = nodeById(g, e.target);
      if (t && !visited.has(t.id)) queue.push(t);
    }
  }
  return { order, visited };
}

/** per-node trigger, derived from its input edge (parent is always visited first) */
function triggerContexts(g: Graph, order: GNode[], stepIndexOf: Map<string, number>): Map<string, TriggerCtx> {
  const ctx = new Map<string, TriggerCtx>();
  const start = g.nodes.find((n) => n.kind === "start");
  if (start) ctx.set(start.id, { trigger: "ON_SUBMIT", stepIndex: null });
  for (const n of order) {
    const inE = g.edges.find((e) => e.target === n.id);
    if (!inE) continue;
    const src = nodeById(g, inE.source);
    if (!src) continue;
    let c: TriggerCtx | null = null;
    if (src.kind === "start") c = { trigger: "ON_SUBMIT", stepIndex: null };
    else if (src.kind === "approval") {
      const idx = stepIndexOf.get(src.id);
      if (idx == null) continue;
      c = inE.sourceHandle === "reject" ? { trigger: "ON_STEP_REJECTED", stepIndex: idx } : { trigger: "ON_STEP_APPROVED", stepIndex: idx };
    } else if (src.kind === "action") c = ctx.get(src.id) ?? null;
    if (c) ctx.set(n.id, c);
  }
  return ctx;
}

/* ------------------------------------------------------------- validation -- */

export interface GraphProblem {
  key: string | null;
  reason: string;
}

export function nodeConfigProblems(n: GNode, g: Graph): string[] {
  const out: string[] = [];
  const d = n.data;
  if (n.kind === "action" && d.condField !== "none") {
    const cErr = validateConditionInput(d.condField, d.condOp, d.condValue);
    if (cErr) out.push(cErr);
  }
  if (n.kind === "approval") {
    if (!d.approverType) out.push("pick who decides for this node");
    if (d.approverType === "ROLE" && !d.targetRoleId) out.push("choose a role");
    if (d.approverType === "GROUP" && !d.targetGroupId) out.push("choose a group");
    if (d.approverType === "USER" && !d.targetUserId) out.push("choose who approves");
    if (d.condField !== "none") {
      const cErr = validateConditionInput(d.condField, d.condOp, d.condValue);
      if (cErr) out.push(cErr);
    }
  }
  if (n.kind === "action") {
    if (d.tool === "SET_PRIORITY" && !d.priority) out.push("pick a priority");
    if (d.tool === "SET_SLA" && !d.slaPolicyId) out.push("choose an SLA policy");
    if (d.tool === "ASSIGN_TO_USER" && !d.userId) out.push("choose the user to assign");
    if (d.tool === "ASSIGN_TO_GROUP" && !d.assignGroupId) out.push("choose the group to assign");
    if (d.tool === "ASSIGN_TO_DEPARTMENT" && !d.assignDepId) out.push("choose the department to assign");
    if (d.tool === "SET_STATUS" && !SETTABLE_STATUSES.some((s) => s.value === d.status)) out.push("choose a status");
    if (d.tool === "NOTIFY") {
      if (!d.notifyTargetType) out.push("choose who to notify");
      if (d.notifyTargetType === "USER" && !d.notifyUserId) out.push("choose the user to notify");
      if (d.notifyTargetType === "GROUP" && !d.notifyGroupId) out.push("choose the group to notify");
      if (d.notifyTargetType === "ROLE" && !d.notifyRoleId) out.push("choose the role to notify");
    }
    if (d.tool === "JUMP_TO_STEP") {
      if (!d.jumpToStepKey) out.push("choose the node to jump to");
      else if (!g.nodes.some((x) => x.id === d.jumpToStepKey && x.kind === "approval")) out.push("the jump target is no longer on the canvas");
    }
  }
  return out;
}

export function validateGraph(g: Graph): GraphProblem[] {
  const problems: GraphProblem[] = [];
  const { visited } = walk(g);
  const starts = g.nodes.filter((n) => n.kind === "start");
  if (starts.length === 0) problems.push({ key: null, reason: "the canvas needs a start node" });
  if (starts.length > 1) problems.push({ key: null, reason: "a flow can only have one start node — delete the extra one" });
  const hasStart = starts.length > 0;
  for (const n of g.nodes) {
    if (hasStart && n.kind !== "start" && !visited.has(n.id))
      problems.push({ key: n.id, reason: "not wired to the start node — connect it or delete it" });
    for (const p of nodeConfigProblems(n, g)) problems.push({ key: n.id, reason: p });
  }
  // an approval reached through a REJECT output would re-open a dead request
  for (const n of g.nodes) {
    if (n.kind !== "approval") continue;
    const inE = g.edges.find((e) => e.target === n.id);
    if (inE && inE.sourceHandle === "reject")
      problems.push({ key: n.id, reason: "an approval cannot come after a rejection — wire it after an approve output" });
  }
  const start = g.nodes.find((n) => n.kind === "start");
  if (start && g.nodes.length > 1 && !g.edges.some((e) => e.source === start.id))
    problems.push({ key: start.id, reason: "connect the start node to your first node" });
  return problems;
}

/* ------------------------------------------------------------ graph → API -- */

export interface GraphApiResult {
  steps: Record<string, unknown>[];
  rules: Record<string, unknown>[];
  problems: GraphProblem[];
  canvasJson: string;
}

const blankIf = (v: string | null | undefined, dflt: string) => (v == null || v === dflt ? "" : v);

export function graphToApi(
  g: Graph,
  opts: { slas?: { id: string; name: string }[]; users?: { UserID: string; Name: string }[]; groups?: { id: string; name: string }[]; departments?: { DEPID: string; Name: string }[] } = {}
): GraphApiResult {
  const problems: GraphProblem[] = [];
  const { order } = walk(g);
  const datas = g.nodes.map((n) => n.data);

  const approvalChain = order.filter((n) => n.kind === "approval");
  const stepIndexOf = new Map(approvalChain.map((a, i) => [a.id, i]));
  const ctxMap = triggerContexts(g, order, stepIndexOf);

  // ---- problems (structure + config)
  for (const p of validateGraph(g)) problems.push(p);

  // ---- steps (approvals in walk order). Hidden legacy settings (quorum, due
  // days, comment policy, on-approve/on-reject) are carried through untouched.
  // `id` (the saved WFStepID) is sent back so the API updates steps in place —
  // without it every save would recreate+delete and hit the "has approval
  // decisions" guard.
  const steps: Record<string, unknown>[] = approvalChain.map((a, i) => ({
    ...(a.data.id ? { id: a.data.id } : {}),
    stepName: derivedStepName(a.data),
    stepOrder: i,
    approverType: a.data.approverType,
    targetUserId: a.data.approverType === "USER" ? a.data.targetUserId || null : null,
    targetGroupId: a.data.approverType === "GROUP" ? a.data.targetGroupId || null : null,
    targetRoleId: a.data.approverType === "ROLE" ? a.data.targetRoleId || null : null,
    ...(a.data.approvalMode ? { approvalMode: a.data.approvalMode } : {}),
    ...(a.data.rejectAction ? { rejectAction: a.data.rejectAction } : {}),
    // approveTargetIndex is 1-based on the API side
    ...(a.data.approveAction
      ? { approveAction: a.data.approveAction, ...(a.data.approveAction === "JUMP_TO_STEP" && a.data.approveTargetKey ? { approveTargetIndex: (stepIndexOf.get(a.data.approveTargetKey) ?? 0) + 1 } : {}) }
      : {}),
    condition: conditionOf(a.data),
    ...((a.data.dueDays ?? "").trim() !== "" ? { dueDays: Number(a.data.dueDays) } : {}),
    ...(a.data.commentPolicy ? { commentPolicy: a.data.commentPolicy } : {}),
  }));

  // ---- rules (action nodes, in walk order = execution order)
  const rules: Record<string, unknown>[] = [];
  for (const n of order) {
    if (n.kind !== "action") continue;
    const c = ctxMap.get(n.id);
    if (!c) continue; // unreachable — already reported
    const payload = actionPayload(n.data, datas);
    if (c.stepIndex != null) payload.fireOnStepOrder = c.stepIndex;
    rules.push({
      name: derivedNodeName(n.data, datas, opts),
      trigger: c.trigger,
      condition: conditionOf(n.data),
      action: n.data.tool,
      actionValue: payload,
      sortOrder: rules.length,
      isActive: n.data.enabled,
    });
  }

  return { steps, rules, problems, canvasJson: JSON.stringify({ v: GRAPH_VERSION, nodes: g.nodes, edges: g.edges }) };
}

/* ------------------------------------------------------------ API → graph -- */

/**
 * Rebuild the canvas. A saved CanvasJson wins (layout preserved); otherwise the
 * graph is derived from steps/rules with an automatic left-to-right layout.
 */
export function apiToGraph(steps: BuilderStep[], rules: BuilderRule[], canvasJson?: string | null): Graph {
  if (canvasJson) {
    try {
      const raw = JSON.parse(canvasJson) as { v?: number; nodes?: Record<string, unknown>[]; edges?: Record<string, unknown>[] };
      if (raw && raw.v === GRAPH_VERSION && Array.isArray(raw.nodes) && Array.isArray(raw.edges) && raw.nodes.length > 0) {
        const nodes: GNode[] = raw.nodes
          // legacy terminals ("End · approved/rejected") no longer exist — the
          // engine finalizes the request by itself; drop them (edges to them
          // fall out via the id check below) and self-heal saved canvases
          .filter((r) => r.kind !== "end_approved" && r.kind !== "end_rejected")
          .map((r) => {
          const rd = (r.data ?? {}) as Record<string, unknown>;
          const kind = (["start", "approval", "action"].includes(String(r.kind)) ? r.kind : "action") as GNodeKind;
          const tool = (typeof rd.tool === "string" && ACTION_NODE_TOOLS.includes(rd.tool as ToolId) ? rd.tool : "NOTIFY") as ToolId;
          const id = String(r.id);
          const rp = r.position as { x?: number; y?: number } | undefined;
          const position =
            rp && typeof rp === "object" && rp.x != null
              ? { x: Number(rp.x), y: Number(rp.y ?? 0) }
              : { x: 0, y: 0 };
          const base = newNode(kind === "approval" ? "APPROVAL" : kind === "start" ? "START" : kind === "action" ? tool : "NOTIFY");
          return { id, kind, position, data: { ...base, ...(rd as Partial<FlowNode>), key: id } };
        });
        const ids = new Set(nodes.map((n) => n.id));
        const edges: GEdge[] = raw.edges
          .map((r) => ({ id: String(r.id), source: String(r.source), sourceHandle: (r.sourceHandle as string) || undefined, target: String(r.target) }))
          .filter((e) => ids.has(e.source) && ids.has(e.target));
        if (!nodes.some((n) => n.kind === "start")) nodes.unshift(makeNode("start", "START", { x: 0, y: 0 }));
        // reconcile step ids: the saved steps (by StepOrder) line up with the
        // approval nodes in execution order. This self-heals the canvas when a
        // save recreated steps (e.g. the very first canvas save of a legacy
        // workflow) so the next save updates them in place instead of trying
        // to delete rows that carry approval decisions.
        const savedSteps = [...steps].sort((a, b) => a.StepOrder - b.StepOrder);
        walk({ nodes, edges }).order
          .filter((n) => n.kind === "approval")
          .forEach((n, i) => {
            const s = savedSteps[i];
            if (s && s.WFStepID) n.data.id = String(s.WFStepID);
          });
        return { nodes, edges };
      }
    } catch {
      /* corrupted canvas — fall back to deriving from steps/rules */
    }
  }
  return deriveGraph(steps, rules);
}

/* ------------------------------------------------------- derivation (legacy -- */

export function deriveGraph(steps: BuilderStep[], rules: BuilderRule[]): Graph {
  const sorted = [...steps].sort((a, b) => a.StepOrder - b.StepOrder);
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const addNode = (n: GNode) => (nodes.push(n), n);
  const link = (s: GNode, handle: string | undefined, t: GNode) => edges.push({ id: nextKey("edge"), source: s.id, sourceHandle: handle, target: t.id });

  const start = addNode(makeNode("start", "START"));
  const approvals = sorted.map((s) => {
    const n = makeNode("approval", "APPROVAL");
    Object.assign(n.data, {
      id: s.WFStepID,
      name: derivedStepName({ name: "", approverType: s.ApproverType }) === s.StepName ? "" : s.StepName,
      approverType: s.ApproverType,
      targetUserId: s.TargetUserID ?? "",
      targetGroupId: s.TargetGroupID ?? "",
      targetRoleId: s.TargetRoleID ?? "",
      // hidden-but-real legacy settings — preserved so they survive a first save
      approvalMode: blankIf(s.ApprovalMode, "ANY_ONE"),
      rejectAction: blankIf(s.RejectAction, "REJECT_COMPLETELY"),
      approveAction: blankIf(s.ApproveAction, "CONTINUE"),
      dueDays: s.DueDays != null ? String(s.DueDays) : "",
      commentPolicy: blankIf(s.CommentPolicy, "OPTIONAL"),
    });
    const cond = parseStepCondition(s.Condition);
    if (cond) Object.assign(n.data, { condField: cond.field, condOp: cond.op, condValue: cond.value });
    return addNode(n);
  });
  // legacy "jump on approve" targets, remapped onto the new approval node ids
  sorted.forEach((s, i) => {
    const jumpIdx = sorted.findIndex((x) => x.WFStepID === s.ApproveTargetStepID);
    if (jumpIdx >= 0) approvals[i].data.approveTargetKey = approvals[jumpIdx].id;
  });

  const actionFromRule = (r: BuilderRule): GNode => {
    const v = parseRuleActionValue(r.ActionValue ?? null);
    const tool = (RULE_ACTIONS.some((a) => a.value === r.Action) ? r.Action : "NOTIFY") as ToolId;
    const n = makeNode("action", tool);
    Object.assign(n.data, {
      name: r.Name,
      enabled: r.IsActive !== false,
      priority: v.priority ?? "",
      status: v.status ?? "",
      slaPolicyId: v.slaPolicyId ?? "",
      userId: v.userId ?? "",
      assignGroupId: v.assignGroupId ?? "",
      assignDepId: v.assignDepId ?? "",
      notifyTargetType: v.notifyTargetType ?? "",
      notifyUserId: v.notifyTargetType === "USER" ? (v.notifyTargetId ?? "") : "",
      notifyGroupId: v.notifyTargetType === "GROUP" ? (v.notifyTargetId ?? "") : "",
      notifyRoleId: v.notifyTargetType === "ROLE" ? (v.notifyTargetId ?? "") : "",
      notifyTitle: v.notifyTitle ?? "",
      notifyMessage: v.notifyMessage ?? "",
    });
    if (tool === "JUMP_TO_STEP" && typeof v.jumpToStepOrder === "number") n.data.jumpToStepKey = approvals[v.jumpToStepOrder]?.id ?? "";
    return addNode(n);
  };

  // bucket rules into chains: submit, per-step approve/reject, and the final outcome
  const lastIdx = approvals.length - 1;
  type ChainKey = string;
  const chains = new Map<ChainKey, BuilderRule[]>();
  const push = (k: ChainKey, r: BuilderRule) => chains.set(k, [...(chains.get(k) ?? []), r]);
  for (const r of rules) {
    const v = parseRuleActionValue(r.ActionValue ?? null);
    const boundApprove = typeof v.fireOnStepOrder === "number" && v.fireOnStepOrder >= 0 && v.fireOnStepOrder <= lastIdx ? `approve-${v.fireOnStepOrder}` : null;
    const boundReject = typeof v.fireOnStepOrder === "number" && v.fireOnStepOrder >= 0 && v.fireOnStepOrder <= lastIdx ? `reject-${v.fireOnStepOrder}` : null;
    if (r.Trigger === "ON_SUBMIT") push("submit", r);
    else if (r.Trigger === "ON_STEP_APPROVED") push(boundApprove ?? (lastIdx >= 0 ? `approve-${lastIdx}` : "submit"), r);
    else if (r.Trigger === "ON_STEP_REJECTED") push(boundReject ?? (lastIdx >= 0 ? `reject-${lastIdx}` : "submit"), r);
    else if (r.Trigger === "ON_REQUEST_APPROVED") push(lastIdx >= 0 ? `approve-${lastIdx}` : "submit", r);
    else if (r.Trigger === "ON_REQUEST_REJECTED" && lastIdx >= 0) push(`reject-${lastIdx}`, r);
    else push("submit", r);
  }

  // main line: start → submit actions → (approval + approve chain)* — a
  // branch may end at any node; the engine sets the final status itself
  let tail = start;
  for (const r of chains.get("submit") ?? []) {
    const a = actionFromRule(r);
    link(tail, tail.kind === "approval" ? "approve" : "out", a);
    tail = a;
  }
  approvals.forEach((a, i) => {
    link(tail, tail.kind === "approval" ? "approve" : "out", a);
    tail = a;
    for (const r of chains.get(`approve-${i}`) ?? []) {
      const x = actionFromRule(r);
      link(tail, "approve", x);
      tail = x;
    }
  });

  // reject branches: each approval's reject output → its actions (may end there)
  approvals.forEach((a, i) => {
    let p = a;
    for (const r of chains.get(`reject-${i}`) ?? []) {
      const x = actionFromRule(r);
      link(p, "reject", x);
      p = x;
    }
  });
  return autoLayout({ nodes, edges });
}

/* ----------------------------------------------------------------- layout -- */

/** deterministic left-to-right layout: main line on top, reject branches below */
export function autoLayout(g: Graph): Graph {
  const pos = new Map<string, { x: number; y: number }>();
  const start = g.nodes.find((n) => n.kind === "start");

  if (start) {
    // main line: start, then follow "out" edges / approval "approve" edges
    const mainLineNodes = mainLine(g);
    const mainOrder = mainLineNodes.map((n, i) => ({ id: n.id, col: i }));
    for (const m of mainOrder) pos.set(m.id, { x: m.col * CELL.x, y: 90 });

    // reject branches on the row below
    const branchSeen = new Set<string>(mainOrder.map((m) => m.id));
    const branchOrder: { id: string; col: number }[] = [];
    for (const n of g.nodes) {
      if (n.kind !== "approval") continue;
      const e = g.edges.find((x) => x.source === n.id && x.sourceHandle === "reject");
      if (!e) continue;
      const baseCol = (mainOrder.find((m) => m.id === n.id)?.col ?? 0) + 1;
      let c: string | undefined = e.target;
      let ccol = baseCol;
      while (c && !branchSeen.has(c)) {
        branchSeen.add(c);
        branchOrder.push({ id: c, col: ccol++ });
        const nx = g.edges.find((x) => x.source === c);
        c = nx ? nx.target : undefined;
      }
    }
    for (const m of branchOrder) pos.set(m.id, { x: m.col * CELL.x, y: 90 + CELL.y });
  }
  // anything left (unwired nodes) parks in a bottom row, visible and fixable
  let gi = 0;
  for (const n of g.nodes) {
    if (pos.has(n.id)) continue;
    pos.set(n.id, { x: (gi % 5) * CELL.x, y: 90 + 2 * CELL.y + Math.floor(gi / 5) * CELL.y });
    gi++;
  }
  return { nodes: g.nodes.map((n) => ({ ...n, position: pos.get(n.id)! })), edges: g.edges };
}

/* ------------------------------------------------------------ recipes -- */

/** the main line: start, then always follow "out" edges (or an approval's "approve" port) */
export function mainLine(g: Graph): GNode[] {
  const start = g.nodes.find((n) => n.kind === "start");
  const line: GNode[] = [];
  if (!start) return line;
  const seen = new Set<string>();
  let cur: GNode | null = start;
  let col = 0;
  while (cur !== null && !seen.has(cur.id) && col < 100) {
    const node: GNode = cur;
    seen.add(node.id);
    line.push(node);
    const outs = g.edges.filter((e) => e.source === node.id);
    const nxt: GEdge | undefined = node.kind === "approval" ? outs.find((e) => e.sourceHandle === "approve") : outs[0];
    cur = nxt ? nodeById(g, nxt.target) : null;
    col += 1;
  }
  return line;
}

/**
 * Append one of the preset recipes as a fresh, fully-connected chain spliced
 * at the end of the main line: the recipe's chips wire in recipe order —
 * approvals continue the main branch, AFTER_APPROVE actions hang on the main
 * branch, AFTER_REJECT actions chain on the last approval's reject port.
 * The tail's main port must be free (nothing is ever taken over).
 */
export function appendRecipeToGraph(g: Graph, recipeId: string): Graph {
  const r = RECIPES.find((x) => x.id === recipeId);
  if (!r) return g;
  const line = mainLine(g);
  const tail = line[line.length - 1];
  if (!tail) return g;

  const mainHandle = (n: GNode): SourceHandle => (n.kind === "approval" ? "approve" : "out");
  if (g.edges.some((e) => e.source === tail.id && e.sourceHandle === mainHandle(tail))) return g;

  let ng: Graph = g;
  const chips = r.build().filter((c) => c.tool !== "START");
  let mainPrev: GNode = tail;
  let rejPrev: GNode | null = null;
  let lastApproval: GNode | null = null;
  let i = 0;
  for (const c of chips) {
    const kind: GNodeKind = c.tool === "APPROVAL" ? "approval" : "action";
    const onReject = c.when === "AFTER_REJECT" && lastApproval !== null;
    const from = onReject ? (rejPrev ?? lastApproval!) : mainPrev;
    const fromHandle: SourceHandle = onReject && rejPrev === null ? "reject" : mainHandle(from);
    const n = makeNode(kind, c.tool, { x: tail.position.x + (i + 1) * CELL.x, y: tail.position.y + (onReject ? CELL.y : 0) });
    ng = { ...ng, nodes: [...ng.nodes, n] };
    ng = connectGraph(ng, { source: from.id, sourceHandle: fromHandle, target: n.id });
    if (kind === "approval") {
      mainPrev = n;
      lastApproval = n;
      rejPrev = null;
    } else if (onReject) {
      rejPrev = n;
    } else {
      mainPrev = n;
    }
    i += 1;
  }
  return ng;
}

