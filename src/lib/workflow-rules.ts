// Event-driven workflow automation rules — pure contracts used by the editor UI,
// the workflows API, and the runtime executor. No prisma import here.

export const RULE_TRIGGERS = [
  { value: 'ON_SUBMIT', label: 'Request is submitted' },
  { value: 'ON_STEP_APPROVED', label: 'A step is approved' },
  { value: 'ON_STEP_REJECTED', label: 'A step is rejected / sent back' },
  { value: 'ON_REQUEST_APPROVED', label: 'Request is fully approved' },
  { value: 'ON_REQUEST_REJECTED', label: 'Request is rejected' },
] as const
export type RuleTrigger = (typeof RULE_TRIGGERS)[number]['value']

export const RULE_ACTIONS = [
  { value: 'SET_PRIORITY', label: 'Set priority' },
  { value: 'SET_SLA', label: 'Apply an SLA policy' },
  { value: 'ASSIGN_TO_USER', label: 'Assign to a user' },
  { value: 'NOTIFY', label: 'Notify people' },
  { value: 'JUMP_TO_STEP', label: 'Jump to a step' },
] as const
export type RuleAction = (typeof RULE_ACTIONS)[number]['value']

export const NOTIFY_TARGET_TYPES = [
  { value: 'USER', label: 'Specific user' },
  { value: 'GROUP', label: 'Group members' },
  { value: 'ROLE', label: 'Users with role' },
  { value: 'DEPARTMENT_MANAGER', label: "Requester's department manager" },
  { value: 'REQUESTER', label: 'The requester' },
] as const

export interface RuleActionValue {
  /** SET_PRIORITY */
  priority?: string
  /** ASSIGN_TO_USER */
  userId?: string
  /** NOTIFY */
  notifyTargetType?: 'USER' | 'GROUP' | 'ROLE' | 'DEPARTMENT_MANAGER' | 'REQUESTER'
  notifyTargetId?: string | null
  notifyTitle?: string
  notifyMessage?: string
  /** JUMP_TO_STEP */
  jumpToStepOrder?: number
  /** SET_SLA — policy whose target matches the request's priority */
  slaPolicyId?: string
  /**
   * Step binding: when set, the rule only runs for the step with this StepOrder
   * (its index in the workflow). Rules without it are flow-wide and fire after
   * every step — that is how pre-existing rules were stored, so nothing breaks.
   */
  fireOnStepOrder?: number
}

/** Does a step-scoped rule belong to this step? Unscoped (legacy) rules match all. */
export function ruleAppliesToStep(v: RuleActionValue, stepOrder: number | null | undefined): boolean {
  if (typeof v.fireOnStepOrder !== 'number') return true
  return stepOrder != null && v.fireOnStepOrder === stepOrder
}

export interface RuleDraft {
  id?: string
  name: string
  trigger: RuleTrigger
  condition?: { field: 'totalValue' | 'itemCount' | 'priority'; op: string; value: string } | null
  action: RuleAction
  actionValue?: RuleActionValue
  sortOrder?: number
  isActive?: boolean
}

export function parseRuleActionValue(raw: string | null | undefined): RuleActionValue {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as RuleActionValue) : {}
  } catch {
    return {}
  }
}

/** Human-readable summary used on rule list rows. */
export function describeRule(
  r: RuleDraft,
  look?: {
    groupName?: (id: string) => string
    userName?: (id: string) => string
    roleName?: (id: string) => string
    slaName?: (id: string) => string
    stepName?: (order: number) => string
  }
): string {
  const when = RULE_TRIGGERS.find((t) => t.value === r.trigger)?.label ?? r.trigger
  const cond = r.condition
    ? ` if ${r.condition.field} ${r.condition.op} ${r.condition.value}`
    : ''
  let then = ''
  const v = r.actionValue ?? {}
  switch (r.action) {
    case 'SET_PRIORITY':
      then = `set priority → ${v.priority ?? '?'}`
      break
    case 'ASSIGN_TO_USER':
      then = `assign → ${v.userId ? look?.userName?.(v.userId) ?? 'user' : 'user'}`
      break
    case 'NOTIFY': {
      const tgt =
        v.notifyTargetType === 'USER'
          ? look?.userName?.(v.notifyTargetId ?? '') ?? 'user'
          : v.notifyTargetType === 'GROUP'
            ? `group ${look?.groupName?.(v.notifyTargetId ?? '') ?? ''}`
            : v.notifyTargetType === 'ROLE'
              ? `role ${look?.roleName?.(v.notifyTargetId ?? '') ?? ''}`
              : v.notifyTargetType === 'DEPARTMENT_MANAGER'
                ? "requester's department manager"
                : 'the requester'
      then = `notify ${tgt}`
      break
    }
    case 'SET_SLA':
      then = `apply SLA → ${v.slaPolicyId ? look?.slaName?.(v.slaPolicyId) ?? 'policy' : 'policy'}`
      break
    case 'JUMP_TO_STEP':
      then = `jump to step #${(v.jumpToStepOrder ?? 0) + 1}`
      break
  }
  const scope =
    typeof v.fireOnStepOrder === 'number' && look?.stepName
      ? ` after "${look.stepName(v.fireOnStepOrder)}"`
      : ''
  return `${when}${cond}${scope} → ${then}`
}
