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
  newAssignedGroupId?: string | null
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
  /** actions never to execute (on-demand runs skip SET_STATUS / JUMP_TO_STEP —
   *  the ticket's lifecycle belongs to its main workflow, not to a preset run) */
  skipActions?: string[]
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

    // caller-supplied safety line (preset runs): skip with a visible audit note
    if (opts.skipActions?.includes(rule.Action)) {
      result.applied.push(
        `Rule "${rule.Name}": skipped (${rule.Action === 'SET_STATUS' ? 'ticket status stays with the main workflow' : 'run chains cannot jump the ticket'})`
      )
      continue
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
        patch.AssignedGroupID = null  // clear group when explicitly assigning to a user
        request.AssigneeID = target.UserID
        result.newAssigneeId = target.UserID
        result.newAssignedGroupId = null
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
      case 'ASSIGN_TO_GROUP': {
        if (!v.assignGroupId) break
        const group = await prisma.groups.findUnique({ where: { GroupID: v.assignGroupId }, select: { GroupID: true, Name: true } })
        const members = await prisma.groupMembers.findMany({ where: { GroupID: v.assignGroupId }, select: { UserID: true } })
        if (members.length === 0) break
        const active = await prisma.users.findMany({
          where: { UserID: { in: members.map((m) => m.UserID) }, IsActive: true },
          select: { UserID: true, Name: true },
        })
        if (active.length === 0) break
        // the request carries a single assignee, so it lands on one member —
        // name order keeps the pick stable across runs, and the whole group
        // is notified so a colleague can take it over
        const target = active.slice().sort((a, b) => a.Name.localeCompare(b.Name))[0]
        patch.AssigneeID = target.UserID
        patch.AssignedGroupID = v.assignGroupId  // track the group so UI can show "Supply Chain"
        request.AssigneeID = target.UserID
        result.newAssigneeId = target.UserID
        result.newAssignedGroupId = v.assignGroupId
        const groupVisible = await filterVisibleUserIds(active.map((u) => u.UserID), request.FormTemplateID)
        if (groupVisible.length > 0) {
          await notifyUsers(groupVisible, {
            title: `Request ${request.TrackingNumber} assigned to ${group?.Name ?? 'your group'}`,
            message: `Workflow rule "${rule.Name}" routed it to your group — currently with ${target.Name}.`,
            type: 'REQUEST_ASSIGNED',
            requestId: request.RequestID,
          })
        }
        result.applied.push(`Rule "${rule.Name}": assigned → group ${group?.Name ?? ''} (with ${target.Name})`)
        break
      }
      case 'ASSIGN_TO_DEPARTMENT': {
        if (!v.assignDepId) break
        const dep = await prisma.dEP.findUnique({ where: { DEPID: v.assignDepId }, select: { DEPID: true, Name: true } })
        if (!dep) break
        // The ticket now belongs to the department — but the system does NOT
        // pick a person on the team's behalf (no manager shortcut). The team
        // must explicitly assign a handler to the ticket, so the work stays
        // coordinated. An existing human assignment is left untouched.
        const members = await prisma.users.findMany({
          where: { DEPID: dep.DEPID, IsActive: true },
          select: { UserID: true },
        })
        const depVisible = await filterVisibleUserIds(
          members
            .map((m) => m.UserID)
            .filter((id) => id !== request.AssigneeID && !(opts.excludeUserIds ?? []).includes(id)),
          request.FormTemplateID
        )
        if (depVisible.length > 0) {
          await notifyUsers(depVisible, {
            title: `Employee must be assigned on ${request.TrackingNumber}`,
            message: `Workflow rule "${rule.Name}" routed this ticket to the ${dep.Name} department — assign a handler so the team can coordinate who works on it.`,
            type: 'REQUEST_ASSIGNED',
            requestId: request.RequestID,
          })
        }
        result.applied.push(`Rule "${rule.Name}": routed to ${dep.Name} department (team must assign a handler)`)
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
        // APPROVED / REJECTED belong to the approval engine
        const ALLOWED = ['DRAFT', 'PENDING_APPROVAL', 'PROCESSING', 'PO_REGISTERED', 'COMPLETED', 'FULFILLED', 'CLARIFICATION_REQUESTED', 'CANCELLED']
        const next = typeof v.status === 'string' ? v.status.toUpperCase() : ''
        if (!ALLOWED.includes(next) || request.Status === next) break
        patch.Status = next
        const now = new Date()
        if (next === 'COMPLETED' || next === 'FULFILLED') patch.CompletedAt = now
        if (next === 'CANCELLED') patch.ResolvedAt = now
        if (next === 'DRAFT') {
          // same shape as the manual "return to requester": drop the open step so a
          // resubmit starts a fresh round instead of resuming a stale one
          patch.CurrentWFStepID = null
          patch.CurrentStepDueAt = null
        }
        request.Status = next
        if (next === 'DRAFT') {
          await notifyUsers([request.RequesterID], {
            title: `Request ${request.TrackingNumber} returned for correction`,
            message: `Workflow rule "${rule.Name}" returned it to you — please re-edit and resubmit.`,
            type: 'REQUEST_REJECTED',
            requestId: request.RequestID,
          })
        }
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
