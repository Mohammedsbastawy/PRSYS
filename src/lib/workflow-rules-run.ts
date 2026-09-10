// Runtime executor for workflow automation rules.
// Called from the request PATCH pipeline after status transitions.

import { prisma } from './prisma'
import { notifyUsers } from './notifications'
import { evaluateStepCondition, parseStepCondition, type ConditionContext } from './workflow-conditions'
import { parseRuleActionValue, type RuleTrigger } from './workflow-rules'

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
}): Promise<RuleRunResult> {
  const rules = await prisma.wFRules.findMany({
    where: { WFDefinitionID: opts.wfDefinitionId, Trigger: opts.trigger, IsActive: true },
    orderBy: { SortOrder: 'asc' },
  })
  const result: RuleRunResult = { applied: [] }
  if (rules.length === 0) return result

  const request = await prisma.requests.findUnique({
    where: { RequestID: opts.requestId },
    select: { RequestID: true, TrackingNumber: true, Priority: true, AssigneeID: true, RequesterID: true, Status: true },
  })
  if (!request) return result

  const patch: Record<string, unknown> = {}

  for (const rule of rules) {
    const cond = parseStepCondition(rule.Condition)
    if (!evaluateStepCondition(cond, opts.condCtx)) continue

    const v = parseRuleActionValue(rule.ActionValue)

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
        await notifyUsers([target.UserID], {
          title: `Request ${request.TrackingNumber} assigned to you`,
          message: `Auto-assigned by workflow rule "${rule.Name}"`,
          type: 'REQUEST_ASSIGNED',
          requestId: request.RequestID,
        })
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
