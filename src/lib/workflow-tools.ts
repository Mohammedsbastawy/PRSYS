// The tools palette definition for the workflow canvas.
//
// Everything here is something the admin can pick — none of it is placed on the
// canvas automatically. Categorized like n8n / ServiceNow Flow Designer:
// a searchable list of nodes, grouped, each with an icon and a one-line blurb.

import type { ToolId, WhenChoice, WhenId } from "./workflow-builder";

export interface Tool {
  id: ToolId;
  label: string;
  icon: string;
  category: string;
  blurb: string;
  /** actions are WFRules, approvals are WFSteps, START is a marker */
  kind: "trigger" | "decision" | "action";
  /** tools that only make sense attached to a decision get a hint in the palette */
  accent: string;
}

export const TOOLS: Tool[] = [
  {
    id: "START",
    label: "Requester submits",
    icon: "play_circle",
    category: "When it starts",
    blurb: "A marker for the moment the request is created. Drop actions on it to run them immediately.",
    kind: "trigger",
    accent: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  {
    id: "APPROVAL",
    label: "Approval / decision",
    icon: "verified_user",
    category: "People",
    blurb: "Someone has to say yes or no. Choose the person, group, role or manager — then what runs on each answer.",
    kind: "decision",
    accent: "bg-surface-container-low text-primary-dark border-surface-variant",
  },
  {
    id: "NOTIFY",
    label: "Notify people",
    icon: "notifications_active",
    category: "People",
    blurb: "Send an in-app (and email) notification to the requester, a manager, a group, a role or one person.",
    kind: "action",
    accent: "bg-violet-50 text-violet-700 border-violet-200",
  },
  {
    id: "ASSIGN_TO_USER",
    label: "Assign an owner",
    icon: "assignment_ind",
    category: "People",
    blurb: "Put the request on a specific user's board and notify them.",
    kind: "action",
    accent: "bg-violet-50 text-violet-700 border-violet-200",
  },
  {
    id: "ASSIGN_TO_GROUP",
    label: "Assign to a group",
    icon: "group",
    category: "People",
    blurb: "Route the request to a team: it lands on the first active member and the whole group is notified, so anyone can take it over.",
    kind: "action",
    accent: "bg-violet-50 text-violet-700 border-violet-200",
  },
  {
    id: "ASSIGN_TO_DEPARTMENT",
    label: "Assign to a department",
    icon: "apartment",
    category: "People",
    blurb: "The department's manager becomes the assignee (skipped if the department has no manager).",
    kind: "action",
    accent: "bg-violet-50 text-violet-700 border-violet-200",
  },
  {
    id: "SET_PRIORITY",
    label: "Set priority",
    icon: "priority_high",
    category: "Update the request",
    blurb: "LOW / MEDIUM / HIGH / URGENT. Later nodes in the flow see the new value right away.",
    kind: "action",
    accent: "bg-secondary-fixed text-amber-700 border-secondary-fixed-dim",
  },
  {
    id: "SET_STATUS",
    label: "Set ticket status",
    icon: "flag",
    category: "Update the request",
    blurb: "Move the ticket itself: return it to the requester, mark the PO registered, complete it, fulfil it, ask for clarification or cancel it.",
    kind: "action",
    accent: "bg-secondary-fixed text-amber-700 border-secondary-fixed-dim",
  },
  {
    id: "SET_SLA",
    label: "Apply SLA policy",
    icon: "timer",
    category: "Update the request",
    blurb: "Re-snapshot the response/resolve clock from a policy — the target matching the request's current priority.",
    kind: "action",
    accent: "bg-cyan-50 text-cyan-700 border-cyan-200",
  },
  {
    id: "JUMP_TO_STEP",
    label: "Jump to a node",
    icon: "skip_next",
    category: "Flow control",
    blurb: "Send the approval chain somewhere else — e.g. straight to a second reviewer when an amount is high.",
    kind: "action",
    accent: "bg-rose-50 text-rose-700 border-rose-200",
  },
];

export const TOOL_BY_ID: Record<string, Tool> = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

export function toolMeta(t: ToolId): Tool {
  return TOOL_BY_ID[t] ?? TOOLS[1];
}

export function toolCategories(): { name: string; tools: Tool[] }[] {
  const out: { name: string; tools: Tool[] }[] = [];
  for (const t of TOOLS) {
    const cat = out.find((c) => c.name === t.category);
    if (cat) cat.tools.push(t);
    else out.push({ name: t.category, tools: [t] });
  }
  return out;
}

/** what triggers exist, in the order a human reads them */
export const WHEN_META: Record<WhenId, { label: string; short: string; icon: string }> = {
  ON_SUBMIT: { label: "when the request is submitted", short: "on submit", icon: "play_circle" },
  AFTER_APPROVE: { label: "after a specific node is approved", short: "on approve", icon: "thumb_up" },
  AFTER_REJECT: { label: "after a specific node is rejected", short: "on reject", icon: "thumb_down" },
  AFTER_DECISION: { label: "after a specific node decides (either way)", short: "on either", icon: "compare_arrows" },
  ANY_APPROVE: { label: "after any approval node approves", short: "any approve", icon: "dns" },
  ANY_REJECT: { label: "if any approval node rejects", short: "any reject", icon: "dns" },
  FINAL_APPROVE: { label: "when the whole request is approved", short: "request approved", icon: "verified" },
  FINAL_REJECT: { label: "when the whole request is rejected", short: "request rejected", icon: "block" },
};

export const WHEN_ORDER: WhenId[] = [
  "ON_SUBMIT",
  "AFTER_APPROVE",
  "AFTER_REJECT",
  "AFTER_DECISION",
  "ANY_APPROVE",
  "ANY_REJECT",
  "FINAL_APPROVE",
  "FINAL_REJECT",
];

/**
 * Statuses automation is allowed to write. The approval engine owns
 * PENDING_APPROVAL / APPROVED / REJECTED, so those are deliberately absent:
 * a rule must not be able to fake a decision.
 */
export const SETTABLE_STATUSES = [
  { value: "DRAFT", label: "Back to draft (return to requester)", note: "reopens it for the requester to re-edit and resubmit" },
  { value: "PENDING_APPROVAL", label: "Pending approval", note: "the engine sets this on submit — use it to move the ticket back to waiting for an approver" },
  { value: "PROCESSING", label: "Processing", note: "approved and being worked on — between approval and the PO / fulfilment" },
  { value: "PO_REGISTERED", label: "PO registered", note: "the purchase order is on file" },
  { value: "FULFILLED", label: "Fulfilled", note: "the work is delivered; stamps the fulfilment time" },
  { value: "COMPLETED", label: "Completed", note: "closes the request and stamps the completion time" },
  { value: "CLARIFICATION_REQUESTED", label: "Ask the requester for clarification", note: "the requester gets a reply box on the request" },
  { value: "CANCELLED", label: "Cancelled", note: "terminal — nobody can approve it afterwards" },
] as const;

export type SettableStatus = (typeof SETTABLE_STATUSES)[number]["value"];

export function statusMeta(v: string) {
  return SETTABLE_STATUSES.find((s) => s.value === v);
}

/** an unset trigger is a real state here: the node cannot be saved until it is chosen */
export function whenMeta(w: WhenChoice): { label: string; short: string; icon: string } {
  return w ? WHEN_META[w] : { label: "not chosen yet", short: "when?", icon: "help" };
}

/** minutes → "2d", "8h", "45m" — same vocabulary the SLA screens use */
export function fmtMins(mins: number | null | undefined): string {
  if (mins == null) return "—";
  if (mins % 1440 === 0 && mins >= 1440) return `${mins / 1440}d`;
  if (mins % 60 === 0 && mins >= 60) return `${mins / 60}h`;
  return `${mins}m`;
}

export interface RecipeSpec {
  tool: ToolId;
  when?: WhenId;
}

export interface Recipe {
  id: string;
  label: string;
  blurb: string;
  icon: string;
  /**
   * A preset only decides which tools to insert and which port they belong to.
   * Names, approvers, priorities and policies stay for the admin to choose.
   */
  build: () => RecipeSpec[];
}

/**
 * Optional starting points: they wire ports for you, never values.
 * Nothing is applied unless the admin clicks one, and every node stays editable.
 */
export const RECIPES: Recipe[] = [
  {
    id: "urgent-sla",
    label: "Approve → set URGENT → apply SLA",
    blurb: "an approval, then two actions on its approve port — values still yours to pick",
    icon: "bolt",
    build: () => [{ tool: "APPROVAL" }, { tool: "SET_PRIORITY", when: "AFTER_APPROVE" }, { tool: "SET_SLA", when: "AFTER_APPROVE" }],
  },
  {
    id: "triage",
    label: "Triage on submit",
    blurb: "a submit marker with three actions hanging on it, nothing filled in",
    icon: "layers",
    build: () => [
      { tool: "START" },
      { tool: "SET_PRIORITY", when: "ON_SUBMIT" },
      { tool: "SET_SLA", when: "ON_SUBMIT" },
      { tool: "NOTIFY", when: "ON_SUBMIT" },
    ],
  },
  {
    id: "reject-path",
    label: "Approval with a reject path",
    blurb: "one approval with actions on both of its ports",
    icon: "split_scene",
    build: () => [
      { tool: "APPROVAL" },
      { tool: "NOTIFY", when: "AFTER_APPROVE" },
      { tool: "NOTIFY", when: "AFTER_REJECT" },
      { tool: "SET_STATUS", when: "AFTER_REJECT" },
    ],
  },
];
