"use client";

/**
 * Workflow builder — one canvas for routing AND automation.
 *
 * A workflow is drawn as a vertical flow: Start (on submit) → approval steps →
 * End (final verdict). Every step card carries its own automations ("after
 * approve" / "after reject" lanes), because that is how the flow is actually
 * read: approve → set priority URGENT → apply the SLA clock, in one place.
 *
 * Storage contract (unchanged, no migration):
 *   steps  → WFSteps
 *   lanes  → WFRules { Trigger: ON_STEP_APPROVED | ON_STEP_REJECTED | ... ,
 *                      ActionValue: { ...action, fireOnStepOrder } }
 * Rules without a step binding stay flow-wide (legacy rules keep firing as
 * before, and are shown in the End node under "after any step").
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
  parseStepCondition,
  validateConditionInput,
} from "@/lib/workflow-conditions";
import { parseRuleActionValue, RULE_ACTIONS } from "@/lib/workflow-rules";

/* ------------------------------------------------------------------ types -- */

type ActionKind = "SET_PRIORITY" | "SET_SLA" | "ASSIGN_TO_USER" | "NOTIFY" | "JUMP_TO_STEP";

interface ActionDraft {
  key: string;
  /** stored as WFRules.Name — auto-derived from the action when left empty */
  name: string;
  kind: ActionKind;
  enabled: boolean;
  condField: string;
  condOp: string;
  condValue: string;
  priority: string;
  slaPolicyId: string;
  userId: string;
  notifyTargetType: string;
  notifyUserId: string;
  notifyGroupId: string;
  notifyRoleId: string;
  notifyTitle: string;
  notifyMessage: string;
  /** target step identified by its editor key (resolved to an index on save) */
  jumpToStepKey: string;
  open: boolean;
}

interface StepDraft {
  key: string;
  id?: string;
  stepName: string;
  approverType: string;
  targetUserId: string;
  targetGroupId: string;
  targetRoleId: string;
  approvalMode: string;
  rejectAction: string;
  approveAction: string;
  approveTargetKey: string;
  condField: string;
  condOp: string;
  condValue: string;
  dueDays: string;
  commentPolicy: string;
  afterApprove: ActionDraft[];
  afterReject: ActionDraft[];
  open: boolean;
}

interface FlowDraft {
  onSubmit: ActionDraft[];
  onApproved: ActionDraft[];
  onRejected: ActionDraft[];
  /** flow-wide step rules (no step binding) — kept so legacy data still shows */
  anyStepApproved: ActionDraft[];
  anyStepRejected: ActionDraft[];
  open: boolean;
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
  Templates: { FormTemplateID: string; Name: string; Status: string }[];
  usage?: { templates: number; liveRequests: number; decisions: number };
}

/* -------------------------------------------------------------- constants -- */

const APPROVER_TYPES: { value: string; label: string; icon: string; hint: string }[] = [
  {
    value: "DEPARTMENT_MANAGER",
    label: "Department manager",
    icon: "apartment",
    hint: "Resolved per request: the requester's department Manager, else their direct manager.",
  },
  {
    value: "REQUESTER_MANAGER",
    label: "Direct manager",
    icon: "account_balance",
    hint: "Resolved per request: Users → Direct manager, else the department manager.",
  },
  { value: "GROUP", label: "Group", icon: "groups", hint: "Everyone in the group can decide." },
  { value: "ROLE", label: "Role", icon: "admin_panel_settings", hint: "Every active user holding the role." },
  { value: "USER", label: "One person", icon: "person", hint: "A single named approver." },
  {
    value: "ANY_APPROVER",
    label: "Any approver",
    icon: "how_to_reg",
    hint: "Anyone with the approve permission — Super Admins are excluded on purpose.",
  },
];

const APPROVAL_MODES = [
  { value: "ANY_ONE", label: "First answer wins" },
  { value: "ALL", label: "Everyone must approve" },
];

const REJECT_ACTIONS = [
  { value: "REJECT_COMPLETELY", label: "Reject the request" },
  { value: "RETURN_TO_REQUESTER", label: "Return to requester" },
  { value: "RETURN_TO_PREVIOUS_STEP", label: "Send back a step" },
];

const APPROVE_ACTIONS = [
  { value: "CONTINUE", label: "Next step" },
  { value: "APPROVE_COMPLETELY", label: "Approve & stop" },
  { value: "JUMP_TO_STEP", label: "Jump to…" },
];

const COMMENT_POLICIES = [
  { value: "OPTIONAL", label: "Comment optional" },
  { value: "ON_REJECT", label: "Required to reject" },
  { value: "ON_APPROVE", label: "Required to approve" },
  { value: "ALWAYS", label: "Always required" },
];

const ACTION_META: Record<ActionKind, { label: string; icon: string; tone: string }> = {
  SET_PRIORITY: { label: "Set priority", icon: "priority_high", tone: "bg-amber-50 text-amber-700 border-amber-200" },
  SET_SLA: { label: "Apply SLA", icon: "timer", tone: "bg-violet-50 text-violet-700 border-violet-200" },
  ASSIGN_TO_USER: { label: "Assign owner", icon: "assignment_ind", tone: "bg-sky-50 text-sky-700 border-sky-200" },
  NOTIFY: { label: "Notify", icon: "notifications_active", tone: "bg-blue-50 text-blue-700 border-blue-200" },
  JUMP_TO_STEP: { label: "Jump to step", icon: "subdirectory_arrow_right", tone: "bg-rose-50 text-rose-700 border-rose-200" },
};

/* ------------------------------------------------------------- small utils -- */

let seq = 0;
const nextKey = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++seq}`;

function blankAction(kind: ActionKind = "SET_PRIORITY"): ActionDraft {
  return {
    key: nextKey("act"),
    name: "",
    kind,
    enabled: true,
    condField: "none",
    condOp: ">=",
    condValue: "",
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
    open: true,
  };
}

function blankStep(open = true): StepDraft {
  return {
    key: nextKey("step"),
    stepName: "",
    approverType: "DEPARTMENT_MANAGER",
    targetUserId: "",
    targetGroupId: "",
    targetRoleId: "",
    approvalMode: "ANY_ONE",
    rejectAction: "RETURN_TO_REQUESTER",
    approveAction: "CONTINUE",
    approveTargetKey: "",
    condField: "none",
    condOp: ">=",
    condValue: "",
    dueDays: "",
    commentPolicy: "OPTIONAL",
    afterApprove: [],
    afterReject: [],
    open,
  };
}

function blankFlow(): FlowDraft {
  return { onSubmit: [], onApproved: [], onRejected: [], anyStepApproved: [], anyStepRejected: [], open: false };
}

function nameFor(a: ActionDraft, steps: StepDraft[], sla?: SlaRow, user?: UserRow): string {
  if (a.name.trim()) return a.name.trim();
  switch (a.kind) {
    case "SET_PRIORITY":
      return `Priority → ${a.priority}`;
    case "SET_SLA":
      return `SLA → ${sla?.name ?? "policy"}`;
    case "ASSIGN_TO_USER":
      return `Assign → ${user?.Name ?? "user"}`;
    case "NOTIFY":
      return a.notifyTitle.trim() || "Notify people";
    case "JUMP_TO_STEP": {
      const i = steps.findIndex((s) => s.key === a.jumpToStepKey);
      return `Jump → ${i >= 0 ? steps[i].stepName || `step ${i + 1}` : "step"}`;
    }
  }
}

/** one-line summary shown on the collapsed chip */
function summaryFor(a: ActionDraft, steps: StepDraft[], slas: SlaRow[], users: UserRow[]): string {
  switch (a.kind) {
    case "SET_PRIORITY":
      return `priority = ${a.priority}`;
    case "SET_SLA":
      return slas.find((s) => s.id === a.slaPolicyId)?.name ?? "pick a policy";
    case "ASSIGN_TO_USER":
      return users.find((u) => u.UserID === a.userId)?.Name ?? "pick a user";
    case "NOTIFY": {
      const who =
        a.notifyTargetType === "USER"
          ? users.find((u) => u.UserID === a.notifyUserId)?.Name ?? "user"
          : a.notifyTargetType === "ROLE"
            ? "role members"
            : a.notifyTargetType === "GROUP"
              ? "group members"
              : a.notifyTargetType === "DEPARTMENT_MANAGER"
                ? "dept manager"
                : "requester";
      return `notify ${who}`;
    }
    case "JUMP_TO_STEP": {
      const i = steps.findIndex((s) => s.key === a.jumpToStepKey);
      return i >= 0 ? `${i + 1}. ${steps[i].stepName || "unnamed"}` : "pick a step";
    }
  }
}

function conditionText(a: ActionDraft): string | null {
  if (a.condField === "none") return null;
  return `${a.condField} ${a.condOp} ${a.condValue}`;
}

function patch<T extends { key: string }>(list: T[], key: string, p: Partial<T>): T[] {
  return list.map((x) => (x.key === key ? { ...x, ...p } : x));
}

/* ------------------------------------------------------------- subviews ---- */

interface LaneHandlers {
  onPatch: (key: string, p: Partial<ActionDraft>) => void;
  onRemove: (key: string) => void;
  onAdd: (kind: ActionKind) => void;
}

function Section({
  title,
  hint,
  children,
  right,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="border-t border-surface-border/70 px-4 py-3 first:border-t-0">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">{title}</h4>
          {hint && <p className="mt-0.5 text-[11px] text-ink-faint">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
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

function ActionRow({
  action,
  steps,
  slas,
  users,
  groups,
  roles,
  disabled,
  onChange,
  onRemove,
}: {
  action: ActionDraft;
  steps: StepDraft[];
  slas: SlaRow[];
  users: UserRow[];
  groups: GroupRow[];
  roles: RoleRow[];
  disabled?: boolean;
  onChange: (p: Partial<ActionDraft>) => void;
  onRemove: () => void;
}) {
  const meta = ACTION_META[action.kind];
  const cond = conditionText(action);
  return (
    <div className={`rounded border ${meta.tone.split(" ")[2]} bg-white`}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ open: !action.open })}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Icon name={meta.icon} className="shrink-0 text-[16px]" />
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-ink-faint">{meta.label}</span>
          <span className="truncate text-xs text-ink">{summaryFor(action, steps, slas, users)}</span>
          {cond && <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] text-ink-soft">if {cond}</span>}
          {!action.enabled && (
            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-ink-faint">off</span>
          )}
        </button>
        {!disabled && (
          <>
            <button
              type="button"
              title={action.enabled ? "Pause this action" : "Resume this action"}
              onClick={() => onChange({ enabled: !action.enabled })}
              className="icon-btn !h-6 !w-6"
            >
              <Icon name={action.enabled ? "pause_circle" : "play_circle"} className="text-[16px]" />
            </button>
            <button type="button" title="Remove" onClick={onRemove} className="icon-btn !h-6 !w-6 text-danger">
              <Icon name="close" className="text-[16px]" />
            </button>
          </>
        )}
      </div>

      {action.open && (
        <div className="space-y-3 border-t border-surface-border/70 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Action</span>
            <select
              className="input w-auto !py-1.5 text-xs"
              disabled={disabled}
              value={action.kind}
              onChange={(e) => onChange({ kind: e.target.value as ActionKind })}
            >
              {RULE_ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          {action.kind === "SET_PRIORITY" && (
            <Segmented
              disabled={disabled}
              value={action.priority}
              onChange={(v) => onChange({ priority: v })}
              options={PRIORITY_VALUES.map((p) => ({ value: p, label: p }))}
            />
          )}

          {action.kind === "SET_SLA" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="label">SLA policy</label>
                <select
                  className="input"
                  disabled={disabled}
                  value={action.slaPolicyId}
                  onChange={(e) => onChange({ slaPolicyId: e.target.value })}
                >
                  <option value="">— choose a policy —</option>
                  {slas.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <p className="self-end pb-2 text-[11px] text-ink-faint">
                Re-snapshots the response (TTA) and resolution (TTR) clocks from the policy targets for the
                request priority.
              </p>
            </div>
          )}

          {action.kind === "ASSIGN_TO_USER" && (
            <div>
              <label className="label">Assign to</label>
              <select className="input" disabled={disabled} value={action.userId} onChange={(e) => onChange({ userId: e.target.value })}>
                <option value="">— choose a user —</option>
                {users.map((u) => (
                  <option key={u.UserID} value={u.UserID}>
                    {u.Name} · {u.Email}
                  </option>
                ))}
              </select>
            </div>
          )}

          {action.kind === "NOTIFY" && (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="label">Who</label>
                  <select
                    className="input"
                    disabled={disabled}
                    value={action.notifyTargetType}
                    onChange={(e) => onChange({ notifyTargetType: e.target.value })}
                  >
                    <option value="REQUESTER">The requester</option>
                    <option value="DEPARTMENT_MANAGER">Requester&apos;s department manager</option>
                    <option value="USER">A specific user</option>
                    <option value="GROUP">All members of a group</option>
                    <option value="ROLE">All users with a role</option>
                  </select>
                </div>
                {action.notifyTargetType === "USER" && (
                  <div>
                    <label className="label">User</label>
                    <select className="input" disabled={disabled} value={action.notifyUserId} onChange={(e) => onChange({ notifyUserId: e.target.value })}>
                      <option value="">— choose —</option>
                      {users.map((u) => (
                        <option key={u.UserID} value={u.UserID}>
                          {u.Name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {action.notifyTargetType === "GROUP" && (
                  <div>
                    <label className="label">Group</label>
                    <select className="input" disabled={disabled} value={action.notifyGroupId} onChange={(e) => onChange({ notifyGroupId: e.target.value })}>
                      <option value="">— choose —</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {action.notifyTargetType === "ROLE" && (
                  <div>
                    <label className="label">Role</label>
                    <select className="input" disabled={disabled} value={action.notifyRoleId} onChange={(e) => onChange({ notifyRoleId: e.target.value })}>
                      <option value="">— choose —</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  className="input"
                  disabled={disabled}
                  placeholder="Notification title (optional)"
                  value={action.notifyTitle}
                  onChange={(e) => onChange({ notifyTitle: e.target.value })}
                />
                <input
                  className="input"
                  disabled={disabled}
                  placeholder="Message (optional)"
                  value={action.notifyMessage}
                  onChange={(e) => onChange({ notifyMessage: e.target.value })}
                />
              </div>
            </div>
          )}

          {action.kind === "JUMP_TO_STEP" && (
            <div>
              <label className="label">Land on step</label>
              <select
                className="input"
                disabled={disabled}
                value={action.jumpToStepKey}
                onChange={(e) => onChange({ jumpToStepKey: e.target.value })}
              >
                <option value="">— choose a step —</option>
                {steps.map((s, i) => (
                  <option key={s.key} value={s.key}>
                    {i + 1}. {s.stepName || "Untitled step"}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="label">Only when</label>
            <ConditionRow
              disabled={disabled}
              field={action.condField}
              op={action.condOp}
              value={action.condValue}
              onChange={(p) => onChange(p)}
            />
          </div>

          <details>
            <summary className="cursor-pointer text-[11px] text-ink-faint hover:text-ink-soft">
              Audit label (how this shows in the request trail)
            </summary>
            <input
              className="input mt-2"
              disabled={disabled}
              placeholder={nameFor(action, steps, slas.find((s) => s.id === action.slaPolicyId), users.find((u) => u.UserID === action.userId))}
              value={action.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </details>
        </div>
      )}
    </div>
  );
}

function ActionLane({
  title,
  icon,
  actions,
  steps,
  slas,
  users,
  groups,
  roles,
  disabled,
  onPatch,
  onRemove,
  onAdd,
}: {
  title: string;
  icon: string;
  actions: ActionDraft[];
  steps: StepDraft[];
  slas: SlaRow[];
  users: UserRow[];
  groups: GroupRow[];
  roles: RoleRow[];
  disabled?: boolean;
  onPatch: (key: string, p: Partial<ActionDraft>) => void;
  onRemove: (key: string) => void;
  onAdd: (kind: ActionKind) => void;
}) {
  const [picker, setPicker] = useState(false);
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        <Icon name={icon} className="text-[14px]" />
        {title}
        {actions.length > 0 && <span className="rounded-full bg-surface-muted px-1.5 text-[10px]">{actions.length}</span>}
      </div>
      <div className="space-y-1.5">
        {actions.map((a) => (
          <ActionRow
            key={a.key}
            action={a}
            steps={steps}
            slas={slas}
            users={users}
            groups={groups}
            roles={roles}
            disabled={disabled}
            onChange={(p) => onPatch(a.key, p)}
            onRemove={() => onRemove(a.key)}
          />
        ))}
        {actions.length === 0 && !disabled && (
          <p className="rounded border border-dashed border-surface-border px-3 py-2 text-[11px] text-ink-faint">
            Nothing runs here yet — add a step for the next thing that should happen.
          </p>
        )}
      </div>
      {!disabled && (
        <div className="relative mt-1.5">
          {picker ? (
            <div className="flex flex-wrap gap-1 rounded border border-surface-border bg-surface-muted/60 p-1.5">
              {(Object.keys(ACTION_META) as ActionKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    onAdd(k);
                    setPicker(false);
                  }}
                  className="flex items-center gap-1 rounded bg-white px-2 py-1 text-[11px] font-medium text-ink shadow-sm hover:bg-blue-50 hover:text-primary-dark"
                >
                  <Icon name={ACTION_META[k].icon} className="text-[14px]" />
                  {ACTION_META[k].label}
                </button>
              ))}
              <button type="button" onClick={() => setPicker(false)} className="icon-btn !h-6 !w-6">
                <Icon name="close" className="text-[14px]" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPicker(true)}
              className="flex items-center gap-1 rounded border border-dashed border-surface-border px-2 py-1 text-[11px] font-medium text-ink-soft hover:border-primary hover:text-primary"
            >
              <Icon name="add" className="text-[14px]" /> Add action
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- page -- */

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
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [flow, setFlow] = useState<FlowDraft>(blankFlow);
  const [usage, setUsage] = useState<LoadedWorkflow["usage"] | null>(null);

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [slas, setSlas] = useState<SlaRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [initialAssigned, setInitialAssigned] = useState<Set<string>>(new Set());

  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const baseline = useRef("");
  const stepRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const dirty = useMemo(() => JSON.stringify({ name, description, status, steps, flow }) !== baseline.current, [
    name,
    description,
    status,
    steps,
    flow,
  ]);

  /* ------------------------------------------------------------ loaders -- */

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

  const applyLoaded = useCallback(
    (w: LoadedWorkflow) => {
      setName(w.Name);
      setDescription(w.Description ?? "");
      setStatus(w.Status);
      setUsage(w.usage ?? null);

      const loadedSteps: StepDraft[] = (w.Steps || []).map((s) => ({
        key: nextKey("step"),
        id: s.WFStepID,
        stepName: s.StepName,
        approverType: s.ApproverType,
        targetUserId: s.TargetUserID ?? "",
        targetGroupId: s.TargetGroupID ?? "",
        targetRoleId: s.TargetRoleID ?? "",
        approvalMode: s.ApprovalMode ?? "ANY_ONE",
        rejectAction: s.RejectAction ?? "REJECT_COMPLETELY",
        approveAction: s.ApproveAction ?? "CONTINUE",
        approveTargetKey: "",
        condField: "none",
        condOp: ">=",
        condValue: "",
        dueDays: s.DueDays != null ? String(s.DueDays) : "",
        commentPolicy: s.CommentPolicy ?? "OPTIONAL",
        afterApprove: [],
        afterReject: [],
        open: (w.Steps || []).length <= 3,
      }));
      // jump targets + conditions need the raw list to map ids → keys
      loadedSteps.forEach((draft, i) => {
        const src = (w.Steps || [])[i];
        const cond = parseStepCondition(src.Condition);
        draft.condField = cond?.field ?? "none";
        draft.condOp = cond?.op ?? ">=";
        draft.condValue = cond?.value ?? "";
        const jumpIdx = (w.Steps || []).findIndex((x) => x.WFStepID === src.ApproveTargetStepID);
        if (jumpIdx >= 0) draft.approveTargetKey = loadedSteps[jumpIdx].key;
      });

      const flowDraft = blankFlow();
      const orderToKey = new Map<number, string>(loadedSteps.map((s, i) => [i, s.key]));
      for (const r of w.Rules || []) {
        const v = parseRuleActionValue(r.ActionValue ?? null);
        const cond = parseStepCondition(r.Condition);
        const act: ActionDraft = {
          key: nextKey("act"),
          name: r.Name,
          kind: (RULE_ACTIONS.some((a) => a.value === r.Action) ? r.Action : "NOTIFY") as ActionKind,
          enabled: r.IsActive,
          condField: cond?.field ?? "none",
          condOp: cond?.op ?? ">=",
          condValue: cond?.value ?? "",
          priority: v.priority ?? "URGENT",
          slaPolicyId: v.slaPolicyId ?? "",
          userId: v.userId ?? "",
          notifyTargetType: v.notifyTargetType ?? "REQUESTER",
          notifyUserId: v.notifyTargetType === "USER" ? v.notifyTargetId ?? "" : "",
          notifyGroupId: v.notifyTargetType === "GROUP" ? v.notifyTargetId ?? "" : "",
          notifyRoleId: v.notifyTargetType === "ROLE" ? v.notifyTargetId ?? "" : "",
          notifyTitle: v.notifyTitle ?? "",
          notifyMessage: v.notifyMessage ?? "",
          jumpToStepKey:
            typeof v.jumpToStepOrder === "number" ? orderToKey.get(v.jumpToStepOrder) ?? "" : "",
          open: false,
        };
        if (r.Trigger === "ON_SUBMIT") flowDraft.onSubmit.push(act);
        else if (r.Trigger === "ON_REQUEST_APPROVED") flowDraft.onApproved.push(act);
        else if (r.Trigger === "ON_REQUEST_REJECTED") flowDraft.onRejected.push(act);
        else if (r.Trigger === "ON_STEP_APPROVED") {
          if (typeof v.fireOnStepOrder === "number") {
            const target = orderToKey.get(v.fireOnStepOrder);
            const sIdx = loadedSteps.findIndex((s) => s.key === target);
            if (sIdx >= 0) loadedSteps[sIdx].afterApprove.push(act);
            else flowDraft.anyStepApproved.push(act);
          } else flowDraft.anyStepApproved.push(act);
        } else if (r.Trigger === "ON_STEP_REJECTED") {
          if (typeof v.fireOnStepOrder === "number") {
            const target = orderToKey.get(v.fireOnStepOrder);
            const sIdx = loadedSteps.findIndex((s) => s.key === target);
            if (sIdx >= 0) loadedSteps[sIdx].afterReject.push(act);
            else flowDraft.anyStepRejected.push(act);
          } else flowDraft.anyStepRejected.push(act);
        }
      }
      // any step carrying automations should be open so nothing is hidden
      loadedSteps.forEach((s) => {
        if (s.afterApprove.length || s.afterReject.length) s.open = true;
      });

      setSteps(loadedSteps);
      setFlow(flowDraft);
      baseline.current = JSON.stringify({
        name: w.Name,
        description: w.Description ?? "",
        status: w.Status,
        steps: loadedSteps,
        flow: flowDraft,
      });
    },
    []
  );

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

  useEffect(() => {
    if (isNew && steps.length === 0) {
      const first = blankStep();
      setSteps([first]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew]);

  /* --------------------------------------------------------- step editing -- */

  const patchStep = (key: string, p: Partial<StepDraft>) => setSteps((prev) => patch(prev, key, p));

  const addStepAt = (index: number) =>
    setSteps((prev) => {
      const next = [...prev];
      next.splice(index, 0, blankStep(true));
      return next;
    });

  const moveStep = (key: string, dir: -1 | 1) =>
    setSteps((prev) => {
      const i = prev.findIndex((s) => s.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const duplicateStep = (key: string) =>
    setSteps((prev) => {
      const i = prev.findIndex((s) => s.key === key);
      if (i < 0) return prev;
      const copy: StepDraft = {
        ...prev[i],
        key: nextKey("step"),
        id: undefined,
        stepName: `${prev[i].stepName || "Step"} (copy)`,
        afterApprove: prev[i].afterApprove.map((a) => ({ ...a, key: nextKey("act"), open: false })),
        afterReject: prev[i].afterReject.map((a) => ({ ...a, key: nextKey("act"), open: false })),
      };
      const next = [...prev];
      next.splice(i + 1, 0, copy);
      return next;
    });

  const removeStep = (key: string) => {
    setSteps((prev) => {
      const gone = prev.find((s) => s.key === key);
      if (!gone) return prev;
      // actions attached to a deleted step would otherwise vanish silently
      const orphan = [...gone.afterApprove, ...gone.afterReject];
      if (orphan.length > 0) {
        setFlow((f) => ({
          ...f,
          anyStepApproved: [...f.anyStepApproved, ...gone.afterApprove],
          anyStepRejected: [...f.anyStepRejected, ...gone.afterReject],
        }));
      }
      return prev.filter((s) => s.key !== key);
    });
  };

  const onDrop = (targetIndex: number) => {
    if (!dragKey) return;
    setSteps((prev) => {
      const from = prev.findIndex((s) => s.key === dragKey);
      if (from < 0 || from === targetIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(targetIndex > from ? targetIndex - 1 : targetIndex, 0, moved);
      return next;
    });
    setDragKey(null);
    setDragOver(null);
  };

  const laneOps = (get: () => ActionDraft[], set: (v: ActionDraft[]) => void): LaneHandlers => ({
    onPatch: (key, p) => set(patch(get(), key, p)),
    onRemove: (key) => set(get().filter((a) => a.key !== key)),
    onAdd: (kind) => set([...get(), blankAction(kind)]),
  });

  const stepLane = (step: StepDraft, which: "afterApprove" | "afterReject") =>
    laneOps(
      () => step[which],
      (v) => patchStep(step.key, { [which]: v } as Partial<StepDraft>)
    );

  const flowLane = (which: keyof Omit<FlowDraft, "open">) =>
    laneOps(
      () => flow[which],
      (v) => setFlow((f) => ({ ...f, [which]: v }))
    );

  /* ----------------------------------------------------------- validation -- */

  interface Issue {
    text: string;
    focusKey?: string;
  }
  const issues = useMemo<Issue[]>(() => {
    const out: Issue[] = [];
    if (!name.trim()) out.push({ text: "The workflow needs a name" });
    const checkActions = (list: ActionDraft[], owner: string, focusKey?: string) => {
      for (const a of list) {
        const at = (t: string) => out.push({ text: `${owner}: ${t}`, focusKey });
        const cErr = validateConditionInput(a.condField === "none" ? null : a.condField, a.condOp, a.condValue);
        if (cErr) at(cErr);
        if (a.kind === "SET_SLA" && !a.slaPolicyId) at("an SLA action needs a policy");
        if (a.kind === "ASSIGN_TO_USER" && !a.userId) at("an assign action needs a user");
        if (a.kind === "NOTIFY") {
          if (a.notifyTargetType === "USER" && !a.notifyUserId) at("notify needs a user");
          if (a.notifyTargetType === "GROUP" && !a.notifyGroupId) at("notify needs a group");
          if (a.notifyTargetType === "ROLE" && !a.notifyRoleId) at("notify needs a role");
        }
        if (a.kind === "JUMP_TO_STEP" && !a.jumpToStepKey) at("a jump action needs a target step");
      }
    };
    steps.forEach((s, i) => {
      const label = s.stepName.trim() || `Step ${i + 1}`;
      if (!s.stepName.trim()) out.push({ text: `Step ${i + 1} has no name`, focusKey: s.key });
      if (s.approverType === "ROLE" && !s.targetRoleId) out.push({ text: `"${label}": choose a role`, focusKey: s.key });
      if (s.approverType === "GROUP" && !s.targetGroupId) out.push({ text: `"${label}": choose a group`, focusKey: s.key });
      if (s.approverType === "USER" && !s.targetUserId) out.push({ text: `"${label}": choose an approver`, focusKey: s.key });
      if (s.dueDays.trim() !== "") {
        const n = Number(s.dueDays);
        if (!Number.isInteger(n) || n < 1 || n > 365)
          out.push({ text: `"${label}": due days must be a whole number 1-365`, focusKey: s.key });
      }
      const cErr = validateConditionInput(s.condField === "none" ? null : s.condField, s.condOp, s.condValue);
      if (cErr) out.push({ text: `"${label}": ${cErr}`, focusKey: s.key });
      if (s.approveAction === "JUMP_TO_STEP") {
        const t = steps.findIndex((x) => x.key === s.approveTargetKey);
        if (!s.approveTargetKey) out.push({ text: `"${label}": choose a jump target`, focusKey: s.key });
        else if (t === i) out.push({ text: `"${label}": cannot jump to itself`, focusKey: s.key });
      }
      checkActions(s.afterApprove, `"${label}" after approve`, s.key);
      checkActions(s.afterReject, `"${label}" after reject`, s.key);
    });
    checkActions(flow.onSubmit, "On submit");
    checkActions(flow.onApproved, "On final approval");
    checkActions(flow.onRejected, "On rejection");
    checkActions(flow.anyStepApproved, "After any step (approved)");
    checkActions(flow.anyStepRejected, "After any step (rejected)");
    return out;
  }, [name, steps, flow]);

  const focusStep = (key?: string) => {
    if (!key) return;
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, open: true } : s)));
    const el = stepRefs.current[key];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /* ----------------------------------------------------------------- save -- */

  const buildRule = (a: ActionDraft, trigger: string, stepOrder: number | undefined, sortOrder: number) => ({
    name: nameFor(
      a,
      steps,
      slas.find((s) => s.id === a.slaPolicyId),
      users.find((u) => u.UserID === a.userId)
    ),
    trigger,
    condition: a.condField === "none" ? null : { field: a.condField, op: a.condOp, value: a.condValue.trim() },
    action: a.kind,
    actionValue: {
      ...(a.kind === "SET_PRIORITY" ? { priority: a.priority } : {}),
      ...(a.kind === "SET_SLA" ? { slaPolicyId: a.slaPolicyId } : {}),
      ...(a.kind === "ASSIGN_TO_USER" ? { userId: a.userId } : {}),
      ...(a.kind === "NOTIFY"
        ? {
            notifyTargetType: a.notifyTargetType,
            notifyTargetId:
              a.notifyTargetType === "USER"
                ? a.notifyUserId
                : a.notifyTargetType === "GROUP"
                  ? a.notifyGroupId
                  : a.notifyTargetType === "ROLE"
                    ? a.notifyRoleId
                    : "",
            ...(a.notifyTitle.trim() ? { notifyTitle: a.notifyTitle.trim() } : {}),
            ...(a.notifyMessage.trim() ? { notifyMessage: a.notifyMessage.trim() } : {}),
          }
        : {}),
      ...(a.kind === "JUMP_TO_STEP"
        ? { jumpToStepOrder: Math.max(0, steps.findIndex((x) => x.key === a.jumpToStepKey)) }
        : {}),
      ...(stepOrder === undefined ? {} : { fireOnStepOrder: stepOrder }),
    },
    sortOrder,
    isActive: a.enabled,
  });

  async function save() {
    setError("");
    if (issues.length > 0) {
      const first = issues[0];
      setError(first.text);
      focusStep(first.focusKey);
      return;
    }
    const stepIndexOf = (key: string) => steps.findIndex((x) => x.key === key);
    // execution order: submit hooks → per step (approve lane, then reject lane)
    // → flow-wide step hooks → final verdict hooks
    const buckets: { lane: ActionDraft[]; trigger: string; stepOrder?: number }[] = [
      { lane: flow.onSubmit, trigger: "ON_SUBMIT" },
      ...steps.flatMap(
        (st, i): { lane: ActionDraft[]; trigger: string; stepOrder: number }[] => [
          { lane: st.afterApprove, trigger: "ON_STEP_APPROVED", stepOrder: i },
          { lane: st.afterReject, trigger: "ON_STEP_REJECTED", stepOrder: i },
        ]
      ),
      { lane: flow.anyStepApproved, trigger: "ON_STEP_APPROVED" },
      { lane: flow.anyStepRejected, trigger: "ON_STEP_REJECTED" },
      { lane: flow.onApproved, trigger: "ON_REQUEST_APPROVED" },
      { lane: flow.onRejected, trigger: "ON_REQUEST_REJECTED" },
    ];
    let order = 0;
    const rules = buckets.flatMap((b) => b.lane.map((a) => buildRule(a, b.trigger, b.stepOrder, order++)));

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
        approvalMode: s.approvalMode,
        rejectAction: s.rejectAction,
        approveAction: s.approveAction,
        approveTargetIndex:
          s.approveAction === "JUMP_TO_STEP" && s.approveTargetKey
            ? stepIndexOf(s.approveTargetKey) + 1
            : null,
        condition: s.condField === "none" ? null : { field: s.condField, op: s.condOp, value: s.condValue.trim() },
        dueDays: s.dueDays.trim() === "" ? null : Number(s.dueDays),
        commentPolicy: s.commentPolicy,
      })),
      rules,
    };

    setSaving(true);
    try {
      const url = isNew ? "/api/workflows" : `/api/workflows/${workflowId}`;
      const res = await fetch(url, {
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
        if (initialAssigned.has(tid)) continue;
        await fetch(`/api/form-templates/${tid}`, {
          method: "PATCH",
          headers: h,
          body: JSON.stringify({ wfDefinitionId: savedId }),
        });
      }
      for (const tid of Array.from(initialAssigned)) {
        if (assigned.has(tid)) continue;
        await fetch(`/api/form-templates/${tid}`, { method: "PATCH", headers: h, body: JSON.stringify({ wfDefinitionId: null }) });
      }
      baseline.current = JSON.stringify({ name, description, status, steps, flow });
      setInitialAssigned(new Set(assigned));
      setSavedAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
      if (isNew && savedId) router.replace(`/workflows/${savedId}`);
      else if (isNew) router.push("/workflows");
      else router.refresh();
    } catch {
      setError("Save failed — check your connection");
    } finally {
      setSaving(false);
    }
  }

  // Ctrl/Cmd+S
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
  }, [ro, dirty, issues, steps, flow, name, description, status]);

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

  const totalActions =
    steps.reduce((n, s) => n + s.afterApprove.length + s.afterReject.length, 0) +
    flow.onSubmit.length +
    flow.onApproved.length +
    flow.onRejected.length +
    flow.anyStepApproved.length +
    flow.anyStepRejected.length;

  const laneCommon = { steps, slas, users, groups, roles, disabled: ro };

  return (
    <AppShell>
      {/* ---------------- header ---------------- */}
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
            <span className="flex items-center gap-1">
              <Icon name="account_tree" className="text-[14px]" /> {steps.length} step{steps.length === 1 ? "" : "s"}
            </span>
            <span className="flex items-center gap-1">
              <Icon name="bolt" className="text-[14px]" /> {totalActions} automation{totalActions === 1 ? "" : "s"}
            </span>
            {usage && (
              <>
                <span>{usage.templates} form{usage.templates === 1 ? "" : "s"} use it</span>
                <span>{usage.liveRequests} live request(s)</span>
                <span>{usage.decisions} recorded decision(s)</span>
              </>
            )}
            <select
              className="input w-auto !py-0.5 text-[11px]"
              disabled={ro}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              title="Workflow status"
            >
              <option value="ACTIVE">Active</option>
              <option value="DRAFT">Draft</option>
            </select>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 lg:pt-6">
          {savedAt && !dirty && <span className="text-[11px] text-ink-faint">saved at {savedAt}</span>}
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
        {/* ---------------- canvas ---------------- */}
        <div className="xl:col-span-8">
          <div className="mx-auto max-w-3xl">
            {/* start node */}
            <div className="rounded-lg border border-surface-border bg-white">
              <button
                type="button"
                onClick={() => setFlow((f) => ({ ...f, open: !f.open }))}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green-100 text-green-700">
                  <Icon name="play_arrow" className="text-[16px]" />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-ink">Requester submits</span>
                  <span className="block text-[11px] text-ink-faint">
                    Validation runs first, then {flow.onSubmit.length} automation
                    {flow.onSubmit.length === 1 ? "" : "s"} here
                  </span>
                </span>
                <Icon name={flow.open ? "expand_less" : "expand_more"} className="text-ink-faint" />
              </button>
              {flow.open && (
                <Section title="Immediately after submit" hint="Runs before the first approval step.">
                  <div className="space-y-3">
                    <ActionLane title="On submit" icon="bolt" actions={flow.onSubmit} {...laneCommon} {...flowLane("onSubmit")} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ActionLane
                        title="After final approval"
                        icon="verified"
                        actions={flow.onApproved}
                        {...laneCommon}
                        {...flowLane("onApproved")}
                      />
                      <ActionLane
                        title="After rejection"
                        icon="block"
                        actions={flow.onRejected}
                        {...laneCommon}
                        {...flowLane("onRejected")}
                      />
                    </div>
                    {(flow.anyStepApproved.length > 0 || flow.anyStepRejected.length > 0) && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <ActionLane
                          title="After any step · approved"
                          icon="unfold_more"
                          actions={flow.anyStepApproved}
                          {...laneCommon}
                          {...flowLane("anyStepApproved")}
                        />
                        <ActionLane
                          title="After any step · rejected"
                          icon="unfold_more"
                          actions={flow.anyStepRejected}
                          {...laneCommon}
                          {...flowLane("anyStepRejected")}
                        />
                      </div>
                    )}
                    <p className="text-[11px] text-ink-faint">
                      &ldquo;After any step&rdquo; lanes are flow-wide (no step binding) and are kept for rules created
                      before per-step automation existed.
                    </p>
                  </div>
                </Section>
              )}
            </div>

            {steps.map((s, i) => {
              const ap = APPROVER_TYPES.find((t) => t.value === s.approverType);
              const targetName =
                s.approverType === "USER"
                  ? users.find((u) => u.UserID === s.targetUserId)?.Name
                  : s.approverType === "GROUP"
                    ? groups.find((g) => g.id === s.targetGroupId)?.name
                    : s.approverType === "ROLE"
                      ? roles.find((r) => r.id === s.targetRoleId)?.name
                      : null;
              const nActions = s.afterApprove.length + s.afterReject.length;
              const stepIssues = issues.filter((x) => x.focusKey === s.key).length;
              return (
                <div key={s.key}>
                  <Connector onAdd={ro ? undefined : () => addStepAt(i)} over={dragOver === i} />
                  <div
                    ref={(el) => {
                      stepRefs.current[s.key] = el;
                    }}
                    onDragOver={(e) => {
                      if (ro) return;
                      e.preventDefault();
                      setDragOver(i);
                    }}
                    onDrop={() => !ro && onDrop(i)}
                    className={`card overflow-hidden transition-shadow ${
                      dragOver === i ? "ring-2 ring-primary/40" : ""
                    } ${stepIssues > 0 ? "border-amber-300" : ""}`}
                  >
                    {/* header */}
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <button
                        type="button"
                        disabled={ro}
                        draggable={!ro}
                        onDragStart={() => setDragKey(s.key)}
                        onDragEnd={() => {
                          setDragKey(null);
                          setDragOver(null);
                        }}
                        onClick={() => patchStep(s.key, { open: !s.open })}
                        className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary-dark"
                        title="Drag to reorder · click to expand"
                      >
                        {i + 1}
                      </button>
                      <input
                        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-ink outline-none hover:border-surface-border focus:border-primary focus:bg-white"
                        value={s.stepName}
                        disabled={ro}
                        placeholder={`Step ${i + 1} name`}
                        onChange={(e) => patchStep(s.key, { stepName: e.target.value })}
                      />
                      <div className="hidden items-center gap-1.5 text-[11px] text-ink-soft sm:flex">
                        <span className="badge bg-surface-muted">
                          <Icon name={ap?.icon ?? "person"} className="mr-1 text-[13px]" />
                          {ap?.label ?? s.approverType}
                          {targetName ? ` · ${targetName}` : ""}
                        </span>
                        {s.approvalMode === "ALL" && <span className="badge bg-indigo-50 text-indigo-700">all must approve</span>}
                        {s.dueDays.trim() !== "" && (
                          <span className="badge bg-surface-muted">{s.dueDays}d due</span>
                        )}
                        {s.condField !== "none" && (
                          <span className="badge bg-surface-muted" title="Conditional step">
                            <Icon name="if_while" className="text-[13px]" />
                          </span>
                        )}
                        {nActions > 0 && (
                          <span className="badge bg-violet-50 text-violet-700">
                            <Icon name="bolt" className="text-[13px]" /> {nActions}
                          </span>
                        )}
                      </div>
                      {stepIssues > 0 && (
                        <span className="badge bg-amber-100 text-amber-800" title="This step needs attention">
                          {stepIssues}
                        </span>
                      )}
                      {!ro && (
                        <div className="flex items-center">
                          <button type="button" className="icon-btn !h-7 !w-7" title="Move up" onClick={() => moveStep(s.key, -1)}>
                            <Icon name="keyboard_arrow_up" className="text-[18px]" />
                          </button>
                          <button type="button" className="icon-btn !h-7 !w-7" title="Move down" onClick={() => moveStep(s.key, 1)}>
                            <Icon name="keyboard_arrow_down" className="text-[18px]" />
                          </button>
                          <button type="button" className="icon-btn !h-7 !w-7" title="Expand / collapse" onClick={() => patchStep(s.key, { open: !s.open })}>
                            <Icon name={s.open ? "expand_less" : "expand_more"} className="text-[18px]" />
                          </button>
                        </div>
                      )}
                    </div>

                    {s.open && (
                      <>
                        <Section title="Who decides" hint={ap?.hint}>
                          <div className="flex flex-wrap items-center gap-2">
                            <Segmented
                              disabled={ro}
                              value={s.approverType}
                              onChange={(v) => patchStep(s.key, { approverType: v })}
                              options={APPROVER_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                            />
                            {s.approverType === "USER" && (
                              <select
                                className="input !w-56 !py-1.5 text-xs"
                                disabled={ro}
                                value={s.targetUserId}
                                onChange={(e) => patchStep(s.key, { targetUserId: e.target.value })}
                              >
                                <option value="">— choose a user —</option>
                                {users.map((u) => (
                                  <option key={u.UserID} value={u.UserID}>
                                    {u.Name} · {u.Email}
                                  </option>
                                ))}
                              </select>
                            )}
                            {s.approverType === "GROUP" && (
                              <select
                                className="input !w-56 !py-1.5 text-xs"
                                disabled={ro}
                                value={s.targetGroupId}
                                onChange={(e) => patchStep(s.key, { targetGroupId: e.target.value })}
                              >
                                <option value="">— choose a group —</option>
                                {groups.map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.name}
                                  </option>
                                ))}
                              </select>
                            )}
                            {s.approverType === "ROLE" && (
                              <select
                                className="input !w-56 !py-1.5 text-xs"
                                disabled={ro}
                                value={s.targetRoleId}
                                onChange={(e) => patchStep(s.key, { targetRoleId: e.target.value })}
                              >
                                <option value="">— choose a role —</option>
                                {roles.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.name}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                          <div className="mt-3 grid gap-3 sm:grid-cols-3">
                            <div>
                              <label className="label">Quorum</label>
                              <Segmented
                                disabled={ro}
                                value={s.approvalMode}
                                onChange={(v) => patchStep(s.key, { approvalMode: v })}
                                options={APPROVAL_MODES}
                              />
                            </div>
                            <div>
                              <label className="label">Comment policy</label>
                              <select
                                className="input !py-1.5 text-xs"
                                disabled={ro}
                                value={s.commentPolicy}
                                onChange={(e) => patchStep(s.key, { commentPolicy: e.target.value })}
                              >
                                {COMMENT_POLICIES.map((c) => (
                                  <option key={c.value} value={c.value}>
                                    {c.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="label">Respond within (days)</label>
                              <input
                                className="input !py-1.5 text-xs"
                                disabled={ro}
                                inputMode="numeric"
                                placeholder="no due date"
                                value={s.dueDays}
                                onChange={(e) => patchStep(s.key, { dueDays: e.target.value })}
                              />
                            </div>
                          </div>
                        </Section>

                        <Section title="When this step applies" hint="Leave as “Always” to run on every request.">
                          <ConditionRow
                            disabled={ro}
                            field={s.condField}
                            op={s.condOp}
                            value={s.condValue}
                            onChange={(p) => patchStep(s.key, p)}
                          />
                        </Section>

                        <Section
                          title="On approve"
                          right={
                            <select
                              className="input w-auto !py-1 text-xs"
                              disabled={ro}
                              value={s.approveAction}
                              onChange={(e) => patchStep(s.key, { approveAction: e.target.value })}
                            >
                              {APPROVE_ACTIONS.map((a) => (
                                <option key={a.value} value={a.value}>
                                  {a.label}
                                </option>
                              ))}
                            </select>
                          }
                        >
                          {s.approveAction === "JUMP_TO_STEP" && (
                            <select
                              className="input mb-2 !w-64 !py-1.5 text-xs"
                              disabled={ro}
                              value={s.approveTargetKey}
                              onChange={(e) => patchStep(s.key, { approveTargetKey: e.target.value })}
                            >
                              <option value="">— land on step —</option>
                              {steps.map((x, xi) => (
                                <option key={x.key} value={x.key} disabled={xi === i}>
                                  {xi + 1}. {x.stepName || "Untitled step"}
                                </option>
                              ))}
                            </select>
                          )}
                          <ActionLane
                            title="Then run, in order"
                            icon="bolt"
                            actions={s.afterApprove}
                            {...laneCommon}
                            {...stepLane(s, "afterApprove")}
                          />
                        </Section>

                        <Section title="On reject">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className="text-[11px] text-ink-faint">then</span>
                            <Segmented
                              disabled={ro}
                              value={s.rejectAction}
                              onChange={(v) => patchStep(s.key, { rejectAction: v })}
                              options={REJECT_ACTIONS}
                            />
                          </div>
                          <ActionLane
                            title="Then run, in order"
                            icon="bolt"
                            actions={s.afterReject}
                            {...laneCommon}
                            {...stepLane(s, "afterReject")}
                          />
                        </Section>

                        {!ro && (
                          <div className="flex items-center justify-end gap-2 border-t border-surface-border/70 px-3 py-2">
                            <button
                              type="button"
                              onClick={() => duplicateStep(s.key)}
                              className="text-[11px] font-medium text-ink-soft hover:text-primary"
                            >
                              Duplicate
                            </button>
                            <button
                              type="button"
                              onClick={() => removeStep(s.key)}
                              className="text-[11px] font-medium text-ink-soft hover:text-danger"
                            >
                              Delete step
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            <Connector onAdd={ro ? undefined : () => addStepAt(steps.length)} over={dragOver === steps.length} />

            {/* end node */}
            <div className="rounded-lg border border-surface-border bg-white p-3">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                  <Icon name="flag" className="text-[16px]" />
                </span>
                <span className="flex-1 text-sm font-semibold text-ink">
                  {steps.length === 0 ? "Approved immediately (no steps)" : "Approved when the last step passes"}
                </span>
              </div>
              {!ro && (
                <button
                  type="button"
                  onClick={() => addStepAt(steps.length)}
                  className="mt-2 flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  <Icon name="add" className="text-[15px]" /> Add an approval step
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ---------------- rail ---------------- */}
        <div className="space-y-4 xl:col-span-4">
          <div className="card p-4">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-faint">Flow map</h3>
            <ol className="space-y-1.5">
              <li className="flex items-center gap-2 text-xs text-ink-soft">
                <Icon name="play_arrow" className="text-[14px] text-green-600" /> Submit
                {flow.onSubmit.length > 0 && <span className="text-violet-600">· {flow.onSubmit.length} ⚡</span>}
              </li>
              {steps.map((s, i) => (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => focusStep(s.key)}
                    className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-surface-muted"
                  >
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary-dark">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ink">{s.stepName || "Untitled step"}</span>
                    {s.afterApprove.length + s.afterReject.length > 0 && (
                      <span className="text-violet-600">{s.afterApprove.length + s.afterReject.length} ⚡</span>
                    )}
                  </button>
                </li>
              ))}
              <li className="flex items-center gap-2 text-xs text-ink-soft">
                <Icon name="flag" className="text-[14px] text-gray-500" /> Close
              </li>
            </ol>
          </div>

          <div className={`card p-4 ${issues.length > 0 ? "border-amber-300" : ""}`}>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-faint">
              <Icon name={issues.length > 0 ? "fact_check" : "check_circle"} className="text-[15px]" />
              Readiness
            </h3>
            {issues.length === 0 ? (
              <p className="text-xs text-green-700">
                {steps.length === 0
                  ? "No steps — requests are approved as soon as they are submitted. Add a step if that is not intended."
                  : "Everything checks out. Save to publish this flow."}
              </p>
            ) : (
              <ul className="space-y-1">
                {issues.map((x, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => focusStep(x.focusKey)}
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
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {templates.map((t) => {
                const on = assigned.has(t.FormTemplateID);
                const takenByOther = !!t.WFDefinitionID && (!isNew || workflowId !== null) && t.WFDefinitionID !== workflowId;
                return (
                  <label
                    key={t.FormTemplateID}
                    className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-surface-muted ${
                      ro ? "cursor-not-allowed opacity-70" : ""
                    }`}
                    title={takenByOther ? "Currently attached to another workflow — checking moves it here" : undefined}
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5"
                      disabled={ro}
                      checked={on}
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
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-ink-faint">
              Ticking a form attaches this workflow to it; unticking detaches. Saved with the workflow.
            </p>
          </div>

          <div className="card p-4 text-[11px] leading-relaxed text-ink-faint">
            <h3 className="mb-1 text-xs font-bold uppercase tracking-wider">How automation runs</h3>
            Actions execute in the order shown, after the decision is recorded, and are written to the request audit
            trail. A Jump to step stops the remaining actions in that lane. Manager-based approvers are resolved per
            request at decision time, so fixing a user&apos;s manager unblocks parked requests.
          </div>
        </div>
      </div>

      {ro && (
        <p className="mt-4 text-center text-xs text-ink-faint">Read-only view — you do not have workflow management.</p>
      )}
    </AppShell>
  );
}

function Connector({ onAdd, over }: { onAdd?: () => void; over?: boolean }) {
  return (
    <div className="flex justify-center py-1">
      <div className={`relative flex h-8 w-full max-w-3xl items-center justify-center ${over ? "bg-blue-50/60" : ""}`}>
        <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-surface-border" />
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="relative flex h-6 w-6 items-center justify-center rounded-full border border-surface-border bg-white text-ink-soft shadow-sm hover:border-primary hover:text-primary"
            title="Insert a step here"
          >
            <Icon name="add" className="text-[14px]" />
          </button>
        )}
      </div>
    </div>
  );
}
