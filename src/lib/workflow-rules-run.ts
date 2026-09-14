// Runtime executor for workflow automation rules.
// Called from the request PATCH pipeline after status transitions.

import { prisma } from './prisma'
import { notifyUsers } from './notifications'
import { filterVisibleUserIds } from './form-visibility'
import { evaluateStepCondition, parseStepCondition, type ConditionContext } from './workflow-conditions'
import { parseRuleActionValue, ruleAppliesToStep, type RuleTrigger } from './workflow-rules'
import { computeDueDates } from './sla'

export interface RuleRunResult {
  applied: string[]         // audit notes, e.g. "Rule «VIP orders»: priority → URGENT"
  jumpedToStepId?: string | null
  newPriority?: string
  newAssigneeId?: string
}

/**
 * Evaluate all active rules of a workflow for one trigger.
 * Matching rules run in SortOrder; JUMP_TO_STEP short-circuits the rest.
 */
export async function runWorkflowRules(opts: {
  wfDefinitionId: string
  trigger: RuleTrigger
  requestId: string
  condCtx: ConditionContext
  actorName: string
  excludeUserIds?: string[] // don't notify the actor
  /** StepOrder of the step being decided — used to filter step-scoped rules */
  stepOrder?: number | null
}): Promise<RuleRunResult> {
  const rules = await prisma.wFRules.findMany({
    where: { WFDefinitionID: opts.wfDefinitionId, Trigger: opts.trigger, IsActive: true },
    orderBy: { SortOrder: 'asc' },
  })
  const result: RuleRunResult = { applied: [] }
  if (rules.length === 0) return result

  const request = await prisma.requests.findUnique({
    where: { RequestID: opts.requestId },
    select: { RequestID: true, TrackingNumber: true, Priority: true, AssigneeID: true, RequesterID: true, Status: true, FormTemplateID: true },
  })
  if (!request) return result

  const patch: Record<string, unknown> = {}

  for (const rule of rules) {
    const cond = parseStepCondition(rule.Condition)
    if (!evaluateStepCondition(cond, opts.condCtx)) continue

    const v = parseRuleActionValue(rule.ActionValue)

    // a rule bound to another step must not fire here (flow-wide rules have no binding)
    if (opts.trigger === 'ON_STEP_APPROVED' || opts.trigger === 'ON_STEP_REJECTED') {
      if (!ruleAppliesToStep(v, opts.stepOrder)) continue
    }

    switch (rule.Action) {
      case 'SET_PRIORITY': {
        if (!v.priority || !['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(v.priority)) break
        if (request.Priority === v.priority) break
        patch.Priority = v.priority
        request.Priority = v.priority
        opts.condCtx = { ...opts.condCtx, priority: v.priority }
        result.newPriority = v.priority
        result.applied.push(`Rule "${rule.Name}": priority → ${v.priority}`)
        break
      }
      case 'ASSIGN_TO_USER': {
        if (!v.userId) break
        const target = await prisma.users.findUnique({ where: { UserID: v.userId }, select: { UserID: true, Name: true, IsActive: true } })
        if (!target?.IsActive) break
        patch.AssigneeID = target.UserID
        request.AssigneeID = target.UserID
        result.newAssigneeId = target.UserID
        const assignVisible = await filterVisibleUserIds([target.UserID], request.FormTemplateID)
        if (assignVisible.length > 0) {
          await notifyUsers(assignVisible, {
            title: `Request ${request.TrackingNumber} assigned to you`,
            message: `Auto-assigned by workflow rule "${rule.Name}"`,
            type: 'REQUEST_ASSIGNED',
            requestId: request.RequestID,
          })
        }
        result.applied.push(`Rule "${rule.Name}": assigned → ${target.Name}`)
        break
      }
      case 'NOTIFY': {
        let ids: string[] = []
        if (v.notifyTargetType === 'USER' && v.notifyTargetId) {
          ids = [v.notifyTargetId]
        } else if (v.notifyTargetType === 'GROUP' && v.notifyTargetId) {
          const rows = await prisma.groupMembers.findMany({ where: { GroupID: v.notifyTargetId }, select: { UserID: true } })
          ids = rows.map((r) => r.UserID)
        } else if (v.notifyTargetType === 'ROLE' && v.notifyTargetId) {
          const rows = await prisma.users.findMany({ where: { RoleID: v.notifyTargetId, IsActive: true }, select: { UserID: true } })
          ids = rows.map((r) => r.UserID)
        } else if (v.notifyTargetType === 'DEPARTMENT_MANAGER') {
          const u = await prisma.users.findUnique({ where: { UserID: request.RequesterID }, select: { DEPID: true } })
          if (u?.DEPID) {
            const dep = await prisma.dEP.findUnique({ where: { DEPID: u.DEPID }, select: { ManagerID: true } })
            if (dep?.ManagerID) ids = [dep.ManagerID]
          }
        } else if (v.notifyTargetType === 'REQUESTER') {
          ids = [request.RequesterID]
        }
        ids = Array.from(new Set(ids)).filter((id) => !(opts.excludeUserIds ?? []).includes(id))
        const requesterIds = ids.filter((id) => id === request.RequesterID)
        const filtered = await filterVisibleUserIds(ids, request.FormTemplateID)
        ids = Array.from(new Set([...filtered, ...requesterIds]))
        if (ids.length === 0) break
        await notifyUsers(ids, {
          title: v.notifyTitle || `Update on ${request.TrackingNumber}`,
          message: v.notifyMessage || `Workflow rule "${rule.Name}" fired for request ${request.TrackingNumber}`,
          type: 'RULE_NOTIFICATION',
          requestId: request.RequestID,
        })
        result.applied.push(`Rule "${rule.Name}": notified ${ids.length} user(s)`)
        break
      }
      case 'SET_SLA': {
        // re-snapshot the SLA targets mid-flight (e.g. a finance review upgrades
        // a LOW request to URGENT and gives it the 1h/8h clock)
        if (!v.slaPolicyId) break
        const policy = await prisma.sLAPolicies.findUnique({
          where: { SLAPolicyID: v.slaPolicyId },
          select: { SLAPolicyID: true, Name: true, Targets: true },
        })
        if (!policy) break
        const t =
          policy.Targets.find((x: { Priority: string }) => x.Priority === request.Priority) ??
          policy.Targets.find((x: { Priority: string }) => x.Priority === 'MEDIUM') ??
          policy.Targets[0]
        if (!t) break
        const due = computeDueDates(
          { Priority: t.Priority, ResponseMins: t.ResponseMins, ResolveMins: t.ResolveMins },
          new Date()
        )
        patch.SLAPolicyID = policy.SLAPolicyID
        if (due.responseDueAt) patch.ResponseDueAt = due.responseDueAt
        if (due.resolveDueAt) patch.ResolveDueAt = due.resolveDueAt
        result.applied.push(`Rule "${rule.Name}": SLA → ${policy.Name}`)
        break
      }
      case 'SET_STATUS': {
        // automation may move the ticket, but never fake a decision:
        // PENDING_APPROVAL / APPROVED / REJECTED belong to the approval engine
        const ALLOWED = ['COMPLETED', 'FULFILLED', 'CLARIFICATION_REQUESTED', 'CANCELLED']
        const next = typeof v.status === 'string' ? v.status.toUpperCase() : ''
        if (!ALLOWED.includes(next) || request.Status === next) break
        patch.Status = next
        const now = new Date()
        if (next === 'COMPLETED' || next === 'FULFILLED') patch.CompletedAt = now
        if (next === 'CANCELLED') patch.ResolvedAt = now
        request.Status = next
        if (next === 'CLARIFICATION_REQUESTED') {
          // same courtesy the manual "ask for clarification" action gives the requester
          await notifyUsers([request.RequesterID], {
            title: `More information needed on ${request.TrackingNumber}`,
            message: `Workflow rule "${rule.Name}" asked the requester to reply on the request.`,
            type: 'REQUEST_CLARIFICATION',
            requestId: request.RequestID,
          })
        }
        result.applied.push(`Rule "${rule.Name}": status → ${next.toLowerCase().replace(/_/g, ' ')}`)
        break
      }
      case 'JUMP_TO_STEP': {
        if (typeof v.jumpToStepOrder !== 'number' || request.Status !== 'PENDING_APPROVAL') break
        const step = await prisma.wFSteps.findFirst({
          where: { WFDefinitionID: opts.wfDefinitionId, StepOrder: v.jumpToStepOrder },
          select: { WFStepID: true, StepName: true, DueDays: true },
        })
        if (!step) break
        patch.CurrentWFStepID = step.WFStepID
        patch.CurrentStepDueAt =
          step.DueDays && step.DueDays > 0 ? new Date(Date.now() + step.DueDays * 86400000) : null
        result.jumpedToStepId = step.WFStepID
        result.applied.push(`Rule "${rule.Name}": jumped to "${step.StepName}"`)
        break
      }
    }

    if (result.jumpedToStepId) break // jump short-circuits like JSM's "transition issue"
  }

  if (Object.keys(patch).length > 0) {
    await prisma.requests.update({ where: { RequestID: request.RequestID }, data: patch })
  }
  return result
}
