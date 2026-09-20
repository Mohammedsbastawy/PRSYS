import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, notFound, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { notifyUsers, usersWithPermission } from '@/lib/notifications'
import { canUserDecideStep, describeStepTarget, stepTargetUserIds } from '@/lib/workflow-targets'
import type { StepTargetInput } from '@/lib/workflow-targets'
import { stepLookups } from '@/lib/workflow-targets-prisma'
import { canUserUseTemplate, filterVisibleUserIds, visibilityBypass } from '@/lib/form-visibility'
import { computeDueDates, type SLATargetRow } from '@/lib/sla'
import { runWorkflowRules, type RuleRunResult } from '@/lib/workflow-rules-run'
import { parseFieldConfig, isValueEmpty, validateFieldValue, parseMultiValue, formatMoney, evalShowWhen } from '@/lib/field-config'
import { parseRequestFormConfig } from '@/lib/form-builtins'
import { parseStepCondition, evaluateStepCondition } from '@/lib/workflow-conditions'
import type { ConditionContext } from '@/lib/workflow-conditions'
import { z } from 'zod'

interface Params { params: { id: string } }

// Resolves step targets (role members, group members, specific user, managers, all approvers)
// — shared prisma-backed lookups (includes DEPARTMENT_MANAGER resolution),
//   see src/lib/workflow-targets-prisma.ts —

// Condition context for step skip-rules: value + size + priority of the request
async function conditionContext(requestId: string, priority: string): Promise<ConditionContext> {
  const items: { RequestedQuantity: unknown; EstimatedPrice: unknown }[] =
    await prisma.requestItems.findMany({
      where: { RequestID: requestId },
      select: { RequestedQuantity: true, EstimatedPrice: true },
    })
  const totalValue = items.reduce(
    (sum: number, it: { RequestedQuantity: unknown; EstimatedPrice: unknown }) =>
      sum + Number(it.RequestedQuantity ?? 0) * Number(it.EstimatedPrice ?? 0),
    0
  )
  return { totalValue, itemCount: items.length, priority }
}

function stepApplies(step: { Condition: string | null }, ctx: ConditionContext): boolean {
  return evaluateStepCondition(parseStepCondition(step.Condition), ctx)
}

/** Active Super Admins — the people who can fix a broken routing gap. */
async function superAdminIds(): Promise<string[]> {
  const rows = await prisma.users.findMany({
    where: { IsActive: true, Role: { Code: 'SUPER_ADMIN' } },
    select: { UserID: true },
  })
  return (rows as { UserID: string }[]).map((r) => r.UserID)
}

/**
 * A routed step whose approver cannot be resolved must NOT be auto-passed.
 * It stays open, gets an audit entry and raises an admin alert, so a missing
 * manager in the org data is fixed instead of silently approving spend.
 * Returns true when the step is unassignable.
 */
async function alertUnassignableStep(
  requestId: string,
  step: (StepTargetInput & { StepName: string; WFStepID: string }) | null | undefined,
  requesterId: string,
  fromStatus: string | null,
  toStatus: string,
  actorId: string | null
): Promise<boolean> {
  if (!step) return false
  const ids = await stepTargetUserIds(step, requesterId, stepLookups())
  if (ids.length > 0) return false
  const note =
    `"${step.StepName}" has no approver (${describeStepTarget(step)}) — ` +
    `set the requester's Direct manager or the department Manager to unblock it`
  await prisma.requestAuditLog.create({
    data: {
      RequestID: requestId,
      FromStatus: fromStatus,
      ToStatus: toStatus,
      Action: 'STEP_UNASSIGNED',
      ChangedByUserID: actorId,
      Note: note.slice(0, 400),
    },
  })
  await notifyUsers(await superAdminIds(), {
    title: `Approval step has no approver — ${requestId.slice(0, 8)}`,
    message: note,
    type: 'REQUEST_SUBMITTED',
    requestId,
  })
  return true
}

// Writes RULE_APPLIED audit entries returned by the automation executor
async function auditRuleResults(requestId: string, from: string, to: string, userId: string, res: RuleRunResult): Promise<void> {
  for (const note of res.applied) {
    await prisma.requestAuditLog.create({
      data: { RequestID: requestId, FromStatus: from, ToStatus: to, Action: 'RULE_APPLIED', ChangedByUserID: userId, Note: note.slice(0, 400) },
    })
  }
}

// SLA policy for a form template (explicit policy preferred, platform default otherwise)
async function resolveSlaTarget(formTemplateId: string, priority: string): Promise<{ policyId: string; target: SLATargetRow } | null> {
  const ft = await prisma.formTemplates.findUnique({
    where: { FormTemplateID: formTemplateId },
    select: { SLAPolicyID: true },
  })
  const policy = await prisma.sLAPolicies.findFirst({
    where: ft?.SLAPolicyID ? { SLAPolicyID: ft.SLAPolicyID } : { IsDefault: true },
    include: { Targets: true },
  })
  if (!policy) return null
  const target =
    policy.Targets.find((t) => t.Priority === priority) ??
    policy.Targets.find((t) => t.Priority === 'MEDIUM') ??
    policy.Targets[0]
  if (!target) return null
  return { policyId: policy.SLAPolicyID, target }
}

// Fresh due date when a request enters a step (null = no due date on the step)
function dueAtFrom(dueDays: number | null | undefined, from: Date): Date | null {
  if (!dueDays || dueDays <= 0) return null
  return new Date(from.getTime() + dueDays * 86400000)
}

function dueSuffix(dueAt: Date | null): string {
  if (!dueAt) return ''
  return ` (due ${dueAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
}

async function resolveRunDueAt(
  wfId: string,
  canvasJson: string | null | undefined,
  dueDays: number | null | undefined,
  priority: string,
  baseDate: Date
): Promise<Date | null> {
  const fromDays = dueAtFrom(dueDays, baseDate)
  if (fromDays) return fromDays

  let slaPolicyId: string | null = null
  const slaRule = await prisma.wFRules.findFirst({
    where: { WFDefinitionID: wfId, Action: 'SET_SLA', IsActive: true },
    orderBy: { SortOrder: 'asc' },
  })
  if (slaRule?.ActionValue) {
    try {
      const parsed = JSON.parse(slaRule.ActionValue) as { slaPolicyId?: string }
      if (parsed?.slaPolicyId) slaPolicyId = parsed.slaPolicyId
    } catch {}
  }
  if (!slaPolicyId && canvasJson) {
    try {
      const parsed = JSON.parse(canvasJson) as { nodes?: { data?: { tool?: string; slaPolicyId?: string } }[] }
      const slaNode = parsed.nodes?.find((n) => n.data?.tool === 'SET_SLA' && n.data?.slaPolicyId)
      if (slaNode?.data?.slaPolicyId) slaPolicyId = slaNode.data.slaPolicyId
    } catch {}
  }
  if (slaPolicyId) {
    const policy = await prisma.sLAPolicies.findUnique({
      where: { SLAPolicyID: slaPolicyId },
      include: { Targets: true },
    })
    if (policy) {
      const t =
        policy.Targets.find((x) => x.Priority === priority) ??
        policy.Targets.find((x) => x.Priority === 'MEDIUM') ??
        policy.Targets[0]
      if (t) {
        const mins = t.ResolveMins || t.ResponseMins || 0
        if (mins > 0) {
          return new Date(baseDate.getTime() + mins * 60 * 1000)
        }
      }
    }
  }
  return null
}

// Statuses in which an on-demand approval run can be decided. Runs never
// change the request status — they ride alongside the main workflow while the
// request is in progress.
const RUN_ACTIVE_STATUSES = ['PENDING_APPROVAL', 'PROCESSING', 'PO_REGISTERED', 'CLARIFICATION_REQUESTED', 'APPROVED', 'FULFILLED']

/**
 * Decide a step of an ON-DEMAND approval run (an approval preset started from
 * inside the request) instead of the main workflow step.
 *
 * Same governance as the main step — canUserDecideStep + the step's comment
 * policy — but deliberately different in three ways:
 *  * the request's status / current step / round are untouched (the agent
 *    keeps working on the ticket while the approval waits),
 *  * only the STEP-BOUND rules fire (the "what happens after" actions —
 *    notify / re-prioritise / re-assign / re-snapshot SLA), and even those
 *    skip SET_STATUS + JUMP_TO_STEP; ON_SUBMIT and the final
 *    ON_REQUEST_* triggers never fire from a run,
 *  * the RUN's own step chain + SLA due date advance — or the run ends.
 */
async function decideRun(opts: {
  requestId: string
  runId: string
  ctx: NonNullable<Awaited<ReturnType<typeof getUserContext>>>
  payload: { userId: string }
  action: 'APPROVE' | 'REJECT'
  comment?: string | null
  now: Date
  actorName: string
}): Promise<Response> {
  const { requestId, runId, ctx, payload, action, now, actorName } = opts
  const notActor = (id: string | null | undefined) => !!id && id !== payload.userId

  const request = await prisma.requests.findUnique({
    where: { RequestID: requestId },
    select: { RequestID: true, Status: true, RequesterID: true, TrackingNumber: true, Priority: true, FormTemplateID: true },
  })
  if (!request) return notFound('Request not found')
  if (!RUN_ACTIVE_STATUSES.includes(request.Status)) {
    return json({ error: 'The request is not in progress' }, 400)
  }

  const run = await prisma.wFRequestRuns.findUnique({
    where: { WFRunID: runId },
    include: {
      CurrentStep: {
        include: {
          TargetUser: { select: { Name: true } },
          TargetGroup: { select: { Name: true } },
          TargetRole: { select: { Name: true } },
          TargetDEP: { select: { Name: true } },
        },
      },
      WFDefinition: {
        select: { Name: true, Steps: { orderBy: { StepOrder: 'asc' } } },
      },
    },
  })
  if (!run || run.RequestID !== requestId) return notFound('Approval run not found')
  if (run.Status !== 'PENDING') return json({ error: 'This approval already has a final decision' }, 400)
  const step = run.CurrentStep
  if (!step) return json({ error: 'This approval run has no active step' }, 400)
  const wfSteps: (StepTargetInput & {
    WFStepID: string
    StepName: string
    StepOrder: number
    DueDays: number | null
    Condition: string | null
  })[] = run.WFDefinition.Steps

  const round = run.Round ?? 1
  const priorDecisions: { ApproverUserID: string; Decision: string }[] = await prisma.requestApprovals.findMany({
    where: { WFRunID: run.WFRunID, WFStepID: step.WFStepID, Round: round, Decision: { not: 'PENDING' } },
    select: { ApproverUserID: true, Decision: true },
  })
  const verdict = await canUserDecideStep({
    step,
    userId: payload.userId,
    requesterId: request.RequesterID,
    isSuperAdmin: ctx.roleCode === 'SUPER_ADMIN',
    hasApprovePerm: hasPermission(ctx, 'REQUEST_APPROVE'),
    lookups: stepLookups(),
    decidedUserIds: priorDecisions.map((d) => d.ApproverUserID),
  })
  if (!verdict.canDecide) return json({ error: verdict.reason ?? 'You cannot decide this step' }, 403)

  const decision = action === 'APPROVE' ? 'APPROVED' : 'REJECTED'
  const cp = step.CommentPolicy ?? 'OPTIONAL'
  const commentRequired =
    cp === 'ALWAYS' || (decision === 'APPROVED' && cp === 'ON_APPROVE') || (decision === 'REJECTED' && cp === 'ON_REJECT')
  if (commentRequired && !(opts.comment ?? '').trim()) {
    return json({ error: `Step "${step.StepName}" requires a comment with this decision` }, 400)
  }
  await prisma.requestApprovals.create({
    data: {
      RequestID: requestId,
      WFStepID: step.WFStepID,
      ApproverUserID: payload.userId,
      Decision: decision,
      Comment: opts.comment ?? null,
      DecidedAt: now,
      Round: round,
      WFRunID: run.WFRunID,
    },
  })

  const approvalMode: string = step.ApprovalMode ?? 'ANY_ONE'
  const approveAction: string = step.ApproveAction ?? 'CONTINUE'
  const targets = await stepTargetUserIds(step, request.RequesterID, stepLookups())
  const approvedIds = new Set(
    priorDecisions.filter((d) => d.Decision === 'APPROVED').map((d) => d.ApproverUserID)
  )
  if (decision === 'APPROVED') approvedIds.add(payload.userId)

  let runStatus = 'PENDING'
  let runCurrentStepId: string | null = step.WFStepID
  let runStepOrder = step.StepOrder
  let newRound = round
  let newDueAt: Date | null = run.DueAt
  let nextStep: (StepTargetInput & {
    WFStepID: string
    StepName: string
    StepOrder: number
    DueDays: number | null
  }) | null = null

  if (decision === 'REJECTED') {
    // preset rejections end the RUN — the request itself keeps going
    runStatus = 'REJECTED'
    runCurrentStepId = null
    newDueAt = null
  } else {
    const waitingOnOthers =
      approvalMode === 'ALL' &&
      (targets.length === 0 ? approvedIds.size === 0 : !targets.every((t: string) => approvedIds.has(t)))
    if (waitingOnOthers) {
      // the step stays open for the remaining approvers — clock unchanged
    } else {
      // the step is complete — route by its approve action (same semantics as
      // the main workflow, scoped to this run's step list)
      const jumpTarget =
        approveAction === 'JUMP_TO_STEP' && step.ApproveTargetStepID
          ? wfSteps.find((s) => s.WFStepID === step.ApproveTargetStepID && s.WFStepID !== step.WFStepID) ?? null
          : null
      if (approveAction === 'APPROVE_COMPLETELY') {
        runStatus = 'APPROVED'
        runCurrentStepId = null
        newDueAt = null
      } else if (jumpTarget) {
        nextStep = jumpTarget
        runCurrentStepId = jumpTarget.WFStepID
        runStepOrder = jumpTarget.StepOrder
        newDueAt = await resolveRunDueAt(run.WFDefinitionID, (run as unknown as { WFDefinition?: { CanvasJson?: string | null } }).WFDefinition?.CanvasJson ?? null, jumpTarget.DueDays, request.Priority, now)
        const targetIdx = wfSteps.findIndex((s) => s.WFStepID === jumpTarget.WFStepID)
        const curIdx = wfSteps.findIndex((s) => s.WFStepID === step.WFStepID)
        if (targetIdx >= 0 && targetIdx <= curIdx) newRound = round + 1 // jumping back re-opens review
      } else {
        // CONTINUE (also the fallback when a jump target is gone)
        const fwdCtx = await conditionContext(requestId, request.Priority)
        const curIdx = wfSteps.findIndex((s) => s.WFStepID === step.WFStepID)
        for (let i = curIdx + 1; i < wfSteps.length; i++) {
          if (stepApplies(wfSteps[i], fwdCtx)) {
            nextStep = wfSteps[i]
            break
          }
        }
        if (nextStep) {
          runCurrentStepId = nextStep.WFStepID
          runStepOrder = nextStep.StepOrder
          newDueAt = await resolveRunDueAt(run.WFDefinitionID, (run as unknown as { WFDefinition?: { CanvasJson?: string | null } }).WFDefinition?.CanvasJson ?? null, nextStep.DueDays, request.Priority, now)
        } else {
          runStatus = 'APPROVED'
          runCurrentStepId = null
          newDueAt = null
        }
      }
    }
  }

  await prisma.wFRequestRuns.update({
    where: { WFRunID: run.WFRunID },
    data: {
      Status: runStatus,
      CurrentStepID: runCurrentStepId,
      StepOrder: runStepOrder,
      Round: newRound,
      DueAt: newDueAt,
      DecidedAt: runStatus === 'PENDING' ? undefined : now,
      DecidedByUserID: runStatus === 'PENDING' ? undefined : payload.userId,
    },
  })
  await prisma.requestAuditLog.create({
    data: {
      RequestID: requestId,
      FromStatus: request.Status,
      ToStatus: request.Status,
      Action: runStatus === 'PENDING' ? 'RUN_STEP_DECIDED' : runStatus === 'APPROVED' ? 'RUN_APPROVED' : 'RUN_REJECTED',
      ChangedByUserID: payload.userId,
      Note:
        `"${run.WFDefinition.Name}" — "${step.StepName}" ${decision.toLowerCase()}${nextStep ? ` → "${nextStep.StepName}"` : ''}${opts.comment ? `: ${opts.comment}` : ''}`.slice(
          0,
          400
        ),
    },
  })
  // step-bound automation — the "and then what" of the preset (notify,
  // re-prioritise, re-assign, re-snapshot SLA). SET_STATUS / JUMP_TO_STEP are
  // skipped: the ticket's lifecycle belongs to its main workflow, not a run.
  {
    const condCtx2 = await conditionContext(requestId, request.Priority)
    const stepRes = await runWorkflowRules({
      wfDefinitionId: run.WFDefinitionID,
      requestId,
      trigger: decision === 'APPROVED' ? 'ON_STEP_APPROVED' : 'ON_STEP_REJECTED',
      condCtx: condCtx2,
      actorName,
      excludeUserIds: [payload.userId],
      stepOrder: step.StepOrder,
      skipActions: ['SET_STATUS', 'JUMP_TO_STEP'],
    })
    await auditRuleResults(requestId, request.Status, request.Status, payload.userId, stepRes)
  }

  // notify whoever is next in the run's chain
  if (runStatus === 'PENDING' && nextStep) {
    const allNext = await stepTargetUserIds(nextStep, request.RequesterID, stepLookups())
    if (allNext.length === 0) {
      await alertUnassignableStep(requestId, nextStep, request.RequesterID, request.Status, request.Status, payload.userId)
    }
    const visibleNext = await filterVisibleUserIds(allNext.filter((id: string) => id !== payload.userId), request.FormTemplateID)
    if (visibleNext.length > 0) {
      await notifyUsers(visibleNext, {
        title: `Approval needed on ${request.TrackingNumber}`,
        message: `${run.WFDefinition.Name} moved to "${nextStep.StepName}"${dueSuffix(newDueAt)}`,
        type: 'REQUEST_SUBMITTED',
        requestId,
      })
    }
  }
  // tell the agent who raised the run what happened (advancing or final)
  if (notActor(run.CreatedByUserID)) {
    await notifyUsers([run.CreatedByUserID], {
      title:
        runStatus === 'PENDING'
          ? `"${run.WFDefinition.Name}" moved forward`
          : `"${run.WFDefinition.Name}" ${runStatus === 'APPROVED' ? 'approved' : 'rejected'}`,
      message:
        `${actorName} ${decision === 'APPROVED' ? 'approved' : 'rejected'} "${step.StepName}"` +
        (nextStep ? ` — next: ${nextStep.StepName}` : '') +
        (opts.comment ? ` — ${opts.comment}` : ''),
      type: 'REQUEST_SUBMITTED',
      requestId,
    })
  }
  // final verdict goes to the requester too
  if (runStatus !== 'PENDING' && notActor(request.RequesterID)) {
    await notifyUsers([request.RequesterID], {
      title: `"${run.WFDefinition.Name}" ${runStatus === 'APPROVED' ? 'approved' : 'rejected'} on ${request.TrackingNumber}`,
      message:
        `"${step.StepName}" ${decision.toLowerCase()} by ${actorName}` + (opts.comment ? ` — ${opts.comment}` : ''),
      type: runStatus === 'APPROVED' ? 'REQUEST_APPROVED' : 'REQUEST_REJECTED',
      requestId,
    })
  }

  const fresh = await prisma.requests.findUnique({ where: { RequestID: requestId } })
  return json(fresh ?? { ok: true })
}

// GET /api/requests/[id]
export async function GET(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx) return forbidden()

  const request = await prisma.requests.findUnique({
    where: { RequestID: params.id },
    include: {
      FormTemplate: {
        include: {
          Category: { select: { Name: true } },
          Workflow: { include: { Steps: { orderBy: { StepOrder: 'asc' } } } },
          OwnerGroup: { select: { GroupID: true, Name: true } },
          OwnerDEP: { select: { DEPID: true, Name: true } },
        },
      },
      Requester: { select: { UserID: true, Name: true, Email: true, DEPID: true } },
      Assignee: { select: { UserID: true, Name: true } },
      AssignedGroup: { select: { GroupID: true, Name: true } },
      PoCreator: { select: { UserID: true, Name: true } },
      SLAPolicy: { select: { SLAPolicyID: true, Name: true } },
      CurrentStep: {
        include: {
          TargetUser: { select: { Name: true } },
          TargetGroup: { select: { Name: true } },
          TargetRole: { select: { Name: true } },
        },
      },
      FieldValues: { include: { FormField: true } },
      Items: {
        include: {
          ItemCatalog: true,
          Verifier: { select: { UserID: true, Name: true } },
        },
      },
      Approvals: { include: { WFStep: true, Approver: { select: { UserID: true, Name: true } } }, orderBy: { CreatedAt: 'asc' } },
      Runs: {
        include: {
          WFDefinition: {
            select: {
              WFDefinitionID: true,
              Name: true,
              Description: true,
              CanvasJson: true,
              Steps: {
                orderBy: { StepOrder: 'asc' },
                include: {
                  TargetUser: { select: { Name: true } },
                  TargetGroup: { select: { Name: true } },
                  TargetRole: { select: { Name: true } },
                  TargetDEP: { select: { Name: true } },
                },
              },
            },
          },
          CurrentStep: {
            include: {
              TargetUser: { select: { Name: true } },
              TargetGroup: { select: { Name: true } },
              TargetRole: { select: { Name: true } },
              TargetDEP: { select: { Name: true } },
            },
          },
          CreatedBy: { select: { UserID: true, Name: true } },
          DecidedBy: { select: { Name: true } },
          Approvals: {
            include: {
              Approver: { select: { UserID: true, Name: true } },
              WFStep: { select: { WFStepID: true, StepName: true } },
            },
            orderBy: { CreatedAt: 'asc' },
          },
        },
        orderBy: { StartedAt: 'asc' },
      },
      Comments: {
        include: { Author: { select: { UserID: true, Name: true, Role: { select: { Name: true } } } } },
        orderBy: { CreatedAt: 'asc' },
      },
      Attachments: {
        include: { Uploader: { select: { UserID: true, Name: true } } },
        orderBy: { CreatedAt: 'asc' },
      },
      AuditLogs: {
        include: { ChangedBy: { select: { Name: true } } },
        orderBy: { CreatedAt: 'asc' },
      },
    },
  })
  if (!request) return notFound('Request not found')

  // visibility check: owner, VIEW_ALL agents, or the manager of the requester's department
  const isOwner = request.RequesterID === payload.userId
  if (!isOwner && !hasPermission(ctx, 'REQUEST_VIEW_ALL')) {
    const depId = request.Requester.DEPID
    const managed = depId
      ? await prisma.dEP.count({ where: { DEPID: depId, ManagerID: payload.userId } })
      : 0
    if (!managed) return forbidden()
  }
  // form-visibility ACL: even an approver/agent cannot read a request of a form
  // they were not granted — the requester always keeps their own requests.
  if (!isOwner && !visibilityBypass(ctx)) {
    const canSeeForm = await canUserUseTemplate(payload.userId, request.FormTemplateID)
    if (!canSeeForm) return forbidden()
  }

  let department: string | null = null
  if (request.Requester.DEPID) {
    const dep = await prisma.dEP.findUnique({
      where: { DEPID: request.Requester.DEPID },
      select: { Name: true },
    })
    department = dep?.Name ?? null
  }

  // internal notes are hidden from the requester
  const canSeeInternal = hasPermission(ctx, 'REQUEST_VIEW_ALL')
  const comments = canSeeInternal ? request.Comments : request.Comments.filter((c) => !c.IsInternal)

  // BigInt is not JSON-serializable — stringify file sizes
  const attachments = request.Attachments.map((a) => ({ ...a, FileSize: a.FileSize.toString() }))

  // Friendly display values for answers (names instead of raw IDs, Yes/No, ...)
  const userIds = new Set<string>()
  const depIds = new Set<string>()
  for (const fv of request.FieldValues) {
    const t = fv.FormField?.FieldType
    if ((t === 'user' || t === 'department') && fv.Value.trim() !== '') {
      if (t === 'user') userIds.add(fv.Value.trim())
      else depIds.add(fv.Value.trim())
    }
  }
  const uRows: { UserID: string; Name: string }[] =
    userIds.size > 0
      ? await prisma.users.findMany({
          where: { UserID: { in: Array.from(userIds) } },
          select: { UserID: true, Name: true },
        })
      : []
  const dRows: { DEPID: string; Name: string }[] =
    depIds.size > 0
      ? await prisma.dEP.findMany({
          where: { DEPID: { in: Array.from(depIds) } },
          select: { DEPID: true, Name: true },
        })
      : []
  const userName = new Map(uRows.map((u) => [u.UserID, u.Name]))
  const depName = new Map(dRows.map((d) => [d.DEPID, d.Name]))
  const fieldValues = request.FieldValues.map((fv) => {
    const t = fv.FormField?.FieldType
    let display: string | null = null
    if (t === 'checkbox') display = fv.Value === 'true' ? 'Yes' : 'No'
    else if (t === 'user') display = userName.get(fv.Value.trim()) ?? fv.Value
    else if (t === 'department') display = depName.get(fv.Value.trim()) ?? fv.Value
    else if (t === 'multiselect') display = parseMultiValue(fv.Value).join(', ')
    else if (t === 'file') {
      const names: string[] = []
      for (const id of parseMultiValue(fv.Value)) {
        const match = request.Attachments.find(
          (a: { RequestAttachmentID: string; FileName: string }) => a.RequestAttachmentID === id
        )
        if (match) names.push(match.FileName)
      }
      display = names.length > 0 ? names.join(', ') : '\u2014'
    }
    else if (t === 'currency') display = formatMoney(fv.Value, parseFieldConfig(fv.FormField?.Config).currency)
    else if (t === 'datetime') display = fv.Value.replace('T', ' ')
    return { ...fv, DisplayValue: display ?? fv.Value }
  })

  // can the viewer decide the current step?
  let canDecide = false
  let decideReason: string | null = null
  let awaitingTarget: string | null = null
  let stepProgress: {
    mode: string
    approved: number
    total: number
    approvedBy: string[]
    myDecided: boolean
  } | null = null
  if (['PENDING_APPROVAL', 'CLARIFICATION_REQUESTED'].includes(request.Status) && request.CurrentStep) {
    awaitingTarget = describeStepTarget(request.CurrentStep)
    // only decisions from the current round count (resubmits start a fresh round)
    const roundDecisions = request.Approvals.filter(
      (a: { WFStepID: string; Round: number; Decision: string; ApproverUserID: string }) =>
        a.WFStepID === request.CurrentWFStepID &&
        (a.Round ?? 1) === (request.Round ?? 1) &&
        a.Decision !== 'PENDING'
    )
    const decidedUserIds: string[] = roundDecisions.map(
      (a: { ApproverUserID: string }) => a.ApproverUserID
    )
    const verdict = await canUserDecideStep({
      step: request.CurrentStep,
      userId: payload.userId,
      requesterId: request.RequesterID,
      isSuperAdmin: ctx.roleCode === 'SUPER_ADMIN',
      hasApprovePerm: hasPermission(ctx, 'REQUEST_APPROVE'),
      lookups: stepLookups(),
      decidedUserIds,
    })
    canDecide = verdict.canDecide
    decideReason = verdict.reason
    const approvedOnes = roundDecisions.filter(
      (a: { Decision: string }) => a.Decision === 'APPROVED'
    )
    const approvedCount = new Set(
      approvedOnes.map((a: { ApproverUserID: string }) => a.ApproverUserID)
    ).size
    const targets = await stepTargetUserIds(request.CurrentStep, request.RequesterID, stepLookups())
    stepProgress = {
      mode: request.CurrentStep.ApprovalMode ?? 'ANY_ONE',
      approved: approvedCount,
      total: Math.max(targets.length, approvedCount),
      approvedBy: approvedOnes.map((a: { Approver?: { Name: string } | null }) => a.Approver?.Name ?? '—'),
      myDecided: decidedUserIds.includes(payload.userId),
    }
  }

  // on-demand approval runs — each keeps its own step + SLA clock, so the
  // page can show who is holding the ticket and since when
  type RunApprovalRow = {
    WFStepID: string
    Round: number | null
    Decision: string
    ApproverUserID: string
    Approver: { Name: string } | null
  }
  type RunRow = {
    WFRunID: string
    Status: string
    CurrentStepID: string | null
    Round: number
    CurrentStep: (StepTargetInput & { ApprovalMode: string | null }) | null
    Approvals: RunApprovalRow[]
  }
  const enrichedRuns = await Promise.all(
    (request.Runs ?? []).map(async (run: RunRow) => {
      const step = run.CurrentStep ?? null
      let runCanDecide = false
      let runDecideReason: string | null = null
      const runLive = run.Status === 'PENDING' && RUN_ACTIVE_STATUSES.includes(request.Status)
      if (run.Status === 'PENDING' && !runLive) {
        // the ticket reached a final status while this approval was waiting
        runDecideReason = 'The request reached a final status'
      }
      let runProgress: {
        mode: string
        approved: number
        total: number
        approvedBy: string[]
        myDecided: boolean
      } | null = null
      if (runLive && step) {
        const prior = run.Approvals.filter(
          (a: RunApprovalRow) => a.WFStepID === run.CurrentStepID && (a.Round ?? 1) === (run.Round ?? 1) && a.Decision !== 'PENDING'
        )
        const decidedIds = prior.map((a: RunApprovalRow) => a.ApproverUserID)
        const verdict = await canUserDecideStep({
          step,
          userId: payload.userId,
          requesterId: request.RequesterID,
          isSuperAdmin: ctx.roleCode === 'SUPER_ADMIN',
          hasApprovePerm: hasPermission(ctx, 'REQUEST_APPROVE'),
          lookups: stepLookups(),
          decidedUserIds: decidedIds,
        })
        runCanDecide = verdict.canDecide
        runDecideReason = verdict.reason
        const approvedOnes = prior.filter((a: RunApprovalRow) => a.Decision === 'APPROVED')
        const approvedCount = new Set(approvedOnes.map((a: RunApprovalRow) => a.ApproverUserID)).size
        const runTargets = await stepTargetUserIds(step, request.RequesterID, stepLookups())
        runProgress = {
          mode: step.ApprovalMode ?? 'ANY_ONE',
          approved: approvedCount,
          total: Math.max(runTargets.length, approvedCount),
          approvedBy: approvedOnes.map((a: RunApprovalRow) => a.Approver?.Name ?? '—'),
          myDecided: decidedIds.includes(payload.userId),
        }
      }
      let runIcon = 'tune'
      try {
        const cj = (run as unknown as { WFDefinition?: { CanvasJson?: string | null } }).WFDefinition?.CanvasJson
        if (cj) {
          const parsed = JSON.parse(cj) as { presetIcon?: string }
          if (parsed?.presetIcon) runIcon = parsed.presetIcon
        }
      } catch {}
      return {
        ...run,
        Icon: runIcon,
        TargetSummary: step ? describeStepTarget(step) : null,
        CanDecide: runCanDecide,
        DecideReason: runDecideReason,
        StepProgress: runProgress,
      }
    })
  )

  // presets the request page can offer as buttons
  const presetRows = await prisma.wFDefinitions.findMany({
    where: { OnDemand: true, Status: 'ACTIVE' },
    select: {
      WFDefinitionID: true,
      Name: true,
      Description: true,
      CanvasJson: true,
      Steps: {
        orderBy: { StepOrder: 'asc' },
        include: {
          TargetUser: { select: { Name: true } },
          TargetGroup: { select: { Name: true } },
          TargetRole: { select: { Name: true } },
          TargetDEP: { select: { Name: true } },
        },
      },
      _count: { select: { Steps: true } },
    },
    orderBy: { Name: 'asc' },
  })

  // Check group memberships for audience filtering
  const userGroupRows = await prisma.groupMembers.findMany({
    where: { UserID: payload.userId },
    select: { GroupID: true },
  })
  const userGroupIds = new Set(userGroupRows.map((g) => g.GroupID))

  const visiblePresetRows = presetRows.filter((wf: { CanvasJson: string | null }) => {
    if (ctx.roleCode === 'SUPER_ADMIN') return true
    if (!wf.CanvasJson) return true
    try {
      const parsed = JSON.parse(wf.CanvasJson) as { presetAudience?: { mode?: string; roleIds?: string[]; depIds?: string[]; groupIds?: string[] } }
      const aud = parsed?.presetAudience
      if (!aud || !aud.mode || aud.mode === 'ALL') return true
      if (aud.mode === 'ROLES') {
        return Array.isArray(aud.roleIds) && aud.roleIds.includes(ctx.roleId)
      }
      if (aud.mode === 'DEPARTMENTS') {
        return !!(ctx.depId && Array.isArray(aud.depIds) && aud.depIds.includes(ctx.depId))
      }
      if (aud.mode === 'GROUPS') {
        return Array.isArray(aud.groupIds) && aud.groupIds.some((gid) => userGroupIds.has(gid))
      }
      return true
    } catch {
      return true
    }
  })

  const approvalPresets = visiblePresetRows.map((wf: {
    WFDefinitionID: string
    Name: string
    Description: string | null
    CanvasJson: string | null
    Steps: StepTargetInput[]
    _count: { Steps: number }
  }) => {
    let icon = "tune";
    try {
      if (wf.CanvasJson) {
        const parsed = JSON.parse(wf.CanvasJson) as { presetIcon?: string };
        if (parsed?.presetIcon) icon = parsed.presetIcon;
      }
    } catch {}
    const first = wf.Steps[0] ?? null;
    return {
      WFDefinitionID: wf.WFDefinitionID,
      Name: wf.Name,
      Description: wf.Description,
      Icon: icon,
      StepCount: wf._count.Steps,
      TargetSummary: first ? describeStepTarget(first) : "No steps",
    };
  });

  return json({ ...request, Runs: enrichedRuns, ApprovalPresets: approvalPresets, Presets: approvalPresets, RequesterDepartment: department, Comments: comments, Attachments: attachments, FieldValues: fieldValues, CanDecide: canDecide, DecideReason: decideReason, AwaitingTarget: awaitingTarget, StepProgress: stepProgress })
}

// PATCH /api/requests/[id] — status transitions
const draftItemSchema = z.object({
  id: z.string().optional().nullable(), // present = update row, absent = new row
  fieldId: z.string().optional().nullable(), // FormFieldID of an "items" field this row belongs to
  name: z.string().min(1).max(300),
  details: z.string().max(2000).optional().nullable(),
  uom: z.string().max(50).optional().nullable(),
  quantity: z.number().positive().max(1000000000),
  catalogId: z.string().optional().nullable(),
  oracleItemId: z.string().optional().nullable(),
  itemCode: z.string().max(100).optional().nullable(),
  itemName: z.string().max(300).optional().nullable(),
  itemUom: z.string().max(50).optional().nullable(),
  orgCode: z.string().max(100).optional().nullable(),
  estimatedPrice: z.number().min(0).max(1000000000000).optional().nullable(),
})

const actionSchema = z.object({
  action: z.enum([
    'SUBMIT',
    'APPROVE',
    'REJECT',
    'REQUEST_APPROVAL',
    'RUN_PRESET',
    'REQUEST_CLARIFICATION',
    'ASSIGN',
    'REGISTER_PO',
    'FULFILL_STOCK',
    'COMPLETE',
    'CANCEL',
    'UPDATE_DRAFT',
    'SET_PRIORITY',
  ]),
  comment: z.string().optional().nullable(),
  // REQUEST_APPROVAL: which on-demand preset to start
  wfDefinitionId: z.string().optional().nullable(),
  // APPROVE/REJECT: when set, the decision belongs to THIS approval run
  // (an on-demand preset) instead of the main workflow step
  wfRunId: z.string().optional().nullable(),
  assigneeId: z.string().optional().nullable(),
  oraclePoNumber: z.string().optional().nullable(),
  poNotes: z.string().optional().nullable(),
  decision: z.string().optional(), // APPROVED | REJECTED
  title: z.string().max(200).optional().nullable(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  neededByDate: z.string().optional().nullable(),
  fieldValues: z.array(z.object({ fieldId: z.string(), value: z.string().max(5000) })).optional(),
  items: z.array(draftItemSchema).optional(),
})

export async function PATCH(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx) return forbidden()

  const { data, error: err } = await parseBody(req, actionSchema)
  if (err) return json({ error: err }, 400)

  const request = await prisma.requests.findUnique({
    where: { RequestID: params.id },
    include: {
      FormTemplate: { include: { Workflow: { include: { Steps: { orderBy: { StepOrder: 'asc' } } } } } },
      Requester: { select: { UserID: true, Name: true } },
    },
  })
  if (!request) return notFound('Request not found')

  const action = data!.action
  const now = new Date()
  const actor = await prisma.users.findUnique({
    where: { UserID: payload.userId },
    select: { Name: true },
  })
  const actorName = actor?.Name ?? 'A user'
  const notActor = (id: string | null | undefined) => !!id && id !== payload.userId

  // ---- SUBMIT ----
  if (action === 'SUBMIT') {
    // only the requester (or super admin) can submit, and only from DRAFT
    if (request.RequesterID !== payload.userId && ctx.roleCode !== 'SUPER_ADMIN') return forbidden()
    if (request.Status !== 'DRAFT') return json({ error: 'Only draft requests can be submitted' }, 400)

    // validate template fields: required presence + value formats
    const tmplFields = await prisma.formFields.findMany({
      where: { FormTemplateID: request.FormTemplateID },
      orderBy: { SortOrder: 'asc' },
    })
    if (tmplFields.length > 0) {
      const vals = await prisma.requestFieldValues.findMany({
        where: { RequestID: params.id },
        select: { FormFieldID: true, Value: true },
      })
      const byField = new Map<string, string>()
      for (const v of vals) {
        if (v.FormFieldID) byField.set(v.FormFieldID, v.Value)
      }
      // conditional visibility: a hidden field pauses its required rule
      const byKeyForCond = (k: string): string => {
        const cf = tmplFields.find((x) => x.FieldKey === k)
        return cf ? byField.get(cf.FormFieldID) ?? '' : ''
      }
      const missing: string[] = []
      for (const f of tmplFields) {
        if (f.FieldType === 'section') continue
        const raw = byField.get(f.FormFieldID) ?? ''
        if (!evalShowWhen(parseFieldConfig(f.Config).showWhen, byKeyForCond)) continue
        if (f.IsRequired && isValueEmpty(f.FieldType, raw)) {
          missing.push(f.Label)
          continue
        }
        if (!isValueEmpty(f.FieldType, raw)) {
          const reason = validateFieldValue(f.FieldType, raw, parseFieldConfig(f.Config))
          if (reason) return json({ error: `Field "${f.Label}": ${reason}` }, 400)
        }
      }
      if (missing.length > 0) {
        return json({ error: `Missing required fields: ${missing.join(', ')}` }, 400)
      }
    }
    const itemCount = await prisma.requestItems.count({ where: { RequestID: params.id } })
    const builtCfg = parseRequestFormConfig((request.FormTemplate as { RequestFormConfig?: string | null } | null)?.RequestFormConfig ?? null)
    const hasCustomItemsField = tmplFields.some((f) => f.FieldType === 'items')
    if (builtCfg.items.show && !hasCustomItemsField && itemCount === 0) return json({ error: 'Add at least one item before submitting' }, 400)

    const wf = request.FormTemplate.Workflow
    const steps = wf?.Steps ?? []
    // resubmits open a fresh round so old decisions stay as history only
    const newRound = request.SubmittedAt ? (request.Round ?? 1) + 1 : (request.Round ?? 1)
    const condCtx = await conditionContext(params.id, request.Priority)
    const skipped: { StepName: string }[] = []
    let firstStep: (StepTargetInput & { WFStepID: string; StepName: string; DueDays: number | null }) | null = null
    for (const s of steps) {
      if (stepApplies(s, condCtx)) {
        firstStep = s
        break
      }
      skipped.push(s)
    }
    const firstDueAt = firstStep ? dueAtFrom(firstStep.DueDays, now) : null
    const update: Record<string, unknown> = {
      Status: firstStep ? 'PENDING_APPROVAL' : 'APPROVED',
      SubmittedAt: now,
      Round: newRound,
      CurrentWFStepID: firstStep?.WFStepID ?? null,
      CurrentStepDueAt: firstDueAt,
    }
    // SLA snapshot: due dates from the form's policy (or the default one) by priority
    const sla = await resolveSlaTarget(request.FormTemplateID, request.Priority)
    if (sla) {
      update.SLAPolicyID = sla.policyId
      const due = computeDueDates(sla.target, now)
      update.ResponseDueAt = due.responseDueAt
      update.ResolveDueAt = due.resolveDueAt
    }
    const updated = await prisma.requests.update({ where: { RequestID: params.id }, data: update })
    await prisma.requestAuditLog.create({
      data: { RequestID: params.id, FromStatus: request.Status, ToStatus: updated.Status, Action: 'SUBMIT', ChangedByUserID: payload.userId },
    })
    for (const s of skipped) {
      await prisma.requestAuditLog.create({
        data: { RequestID: params.id, FromStatus: request.Status, ToStatus: updated.Status, Action: 'STEP_SKIPPED', ChangedByUserID: payload.userId, Note: `"${s.StepName}" skipped (condition not met, round ${newRound})` },
      })
    }
    const firstTargets = firstStep
      ? await stepTargetUserIds(firstStep, request.RequesterID, stepLookups())
      : []
    // no manager anywhere in the org data -> the step stays open and the admins
    // are told, instead of the request quietly rolling past it
    const unassigned = await alertUnassignableStep(
      params.id, firstStep, request.RequesterID, request.Status, updated.Status, payload.userId
    )
    const approvers = (
      firstTargets.length > 0 ? firstTargets : await usersWithPermission('REQUEST_APPROVE')
    ).filter((id) => id !== payload.userId)
    await notifyUsers(approvers, {
      title: unassigned ? 'New request — no approver assigned yet' : 'New request needs approval',
      message: unassigned
        ? `${request.Requester.Name} submitted ${request.TrackingNumber} (${request.FormTemplate.Name}) but "${firstStep?.StepName}" has no approver — set the requester's direct manager or their department manager.`
        : `${request.Requester.Name} submitted ${request.TrackingNumber} (${request.FormTemplate.Name})${dueSuffix(firstDueAt)}`,
      type: 'REQUEST_SUBMITTED',
      requestId: params.id,
    })
    // notify the form owner (owner group members + owner department manager),
    // skipping the actor and approvers already notified above
    const ownerTargets: string[] = []
    if (request.FormTemplate.OwnerGroupID) {
      const members = await prisma.groupMembers.findMany({
        where: { GroupID: request.FormTemplate.OwnerGroupID },
        select: { UserID: true },
      })
      ownerTargets.push(...members.map((m) => m.UserID))
    }
    if (request.FormTemplate.OwnerDEPID) {
      const dep = await prisma.dEP.findUnique({
        where: { DEPID: request.FormTemplate.OwnerDEPID },
        select: { ManagerID: true },
      })
      if (dep?.ManagerID) ownerTargets.push(dep.ManagerID)
    }
    const alreadyNotified = new Set([...approvers, payload.userId])
    const ownerNotify = Array.from(new Set(ownerTargets)).filter((id) => !alreadyNotified.has(id))
    if (ownerNotify.length > 0) {
      await notifyUsers(ownerNotify, {
        title: 'New request on your form',
        message: `${request.Requester.Name} submitted ${request.TrackingNumber} on your form (${request.FormTemplate.Name})`,
        type: 'REQUEST_SUBMITTED',
        requestId: params.id,
      })
    }
    // ---- automation: fire ON_SUBMIT rules (priority routing, auto-assign, notifications) ----
    if (request.FormTemplate.WFDefinitionID) {
      const condCtx2 = await conditionContext(params.id, updated.Priority)
      const res = await runWorkflowRules({
        wfDefinitionId: request.FormTemplate.WFDefinitionID,
        trigger: 'ON_SUBMIT',
        requestId: params.id,
        condCtx: condCtx2,
        actorName,
        excludeUserIds: [payload.userId],
      })
      await auditRuleResults(params.id, updated.Status, updated.Status, payload.userId, res)
    }
    const fresh = await prisma.requests.findUnique({ where: { RequestID: params.id } })
    return json(fresh ?? updated)
  }

  // ---- REQUEST_APPROVAL — start an on-demand approval preset on this ticket ----
  // An agent stuck on a request (or the requester) fires a preset workflow
  // (e.g. "Budget Approval" → the accounting department's manager). The run
  // tracks its own steps + SLA inside the request; the main workflow continues
  // untouched. Every pending run is listed on the request page, so several
  // approvals — each with its own due date — are all visible at once.
  if (action === 'REQUEST_APPROVAL' || action === 'RUN_PRESET') {
    const wfId = data!.wfDefinitionId
    if (!wfId) return json({ error: 'Choose a preset workflow' }, 400)
    if (!RUN_ACTIVE_STATUSES.includes(request.Status)) {
      return json({ error: 'You can only run a preset while the request is in progress' }, 400)
    }
    // the handling agent, the requester, an assigner, or a super admin
    const canRequest =
      request.AssigneeID === payload.userId ||
      request.RequesterID === payload.userId ||
      hasPermission(ctx, 'REQUEST_ASSIGN') ||
      ctx.roleCode === 'SUPER_ADMIN'
    if (!canRequest) {
      return json({ error: 'Only the handling agent (or the requester) can run a preset' }, 403)
    }
    const wf = await prisma.wFDefinitions.findUnique({
      where: { WFDefinitionID: wfId },
      include: { Steps: { orderBy: { StepOrder: 'asc' } } },
    })
    if (!wf || !wf.OnDemand || wf.Status !== 'ACTIVE') {
      return json({ error: 'Preset workflow not found' }, 404)
    }

    // Check audience permissions
    if (wf.CanvasJson && ctx.roleCode !== 'SUPER_ADMIN') {
      try {
        const parsed = JSON.parse(wf.CanvasJson) as { presetAudience?: { mode?: string; roleIds?: string[]; depIds?: string[]; groupIds?: string[] } }
        const aud = parsed?.presetAudience
        if (aud && aud.mode && aud.mode !== 'ALL') {
          let allowed = false
          if (aud.mode === 'ROLES') {
            allowed = Array.isArray(aud.roleIds) && aud.roleIds.includes(ctx.roleId)
          } else if (aud.mode === 'DEPARTMENTS') {
            allowed = !!(ctx.depId && Array.isArray(aud.depIds) && aud.depIds.includes(ctx.depId))
          } else if (aud.mode === 'GROUPS') {
            const userGroups = await prisma.groupMembers.findMany({ where: { UserID: payload.userId }, select: { GroupID: true } })
            const gids = new Set(userGroups.map((g) => g.GroupID))
            allowed = Array.isArray(aud.groupIds) && aud.groupIds.some((gid) => gids.has(gid))
          }
          if (!allowed) {
            return json({ error: 'You are not authorized to run this preset' }, 403)
          }
        }
      } catch {
        /* ignore json parse error */
      }
    }

    if (wf.Steps.length === 0) return json({ error: `"${wf.Name}" has no approval steps` }, 400)
    const activeRun = await prisma.wFRequestRuns.findFirst({
      where: { RequestID: params.id, WFDefinitionID: wfId, Status: 'PENDING' },
      select: { WFRunID: true },
    })
    if (activeRun) return json({ error: `"${wf.Name}" is already waiting on this request` }, 409)

    const condCtx = await conditionContext(params.id, request.Priority)
    const firstStep: (StepTargetInput & {
      WFStepID: string
      StepName: string
      StepOrder: number
      DueDays: number | null
    }) | null =
      wf.Steps.find((s: { Condition: string | null }) => stepApplies(s, condCtx)) ?? null
    if (!firstStep) return json({ error: `"${wf.Name}" has no step that applies to this request` }, 400)

    const dueAt = await resolveRunDueAt(wfId, wf.CanvasJson, firstStep.DueDays, request.Priority, now)
    const run = await prisma.wFRequestRuns.create({
      data: {
        RequestID: params.id,
        WFDefinitionID: wfId,
        CurrentStepID: firstStep.WFStepID,
        StepOrder: firstStep.StepOrder,
        Round: 1,
        DueAt: dueAt,
        CreatedByUserID: payload.userId,
      },
    })
    await prisma.requestAuditLog.create({
      data: {
        RequestID: params.id,
        FromStatus: request.Status,
        ToStatus: request.Status,
        Action: 'APPROVAL_REQUESTED',
        ChangedByUserID: payload.userId,
        Note: `"${wf.Name}" started at "${firstStep.StepName}"`,
      },
    })
    await runWorkflowRules({
      wfDefinitionId: wfId,
      trigger: 'ON_SUBMIT',
      requestId: params.id,
      condCtx,
      actorName,
      skipActions: ['SET_STATUS', 'JUMP_TO_STEP'],
    })
    const targets = await stepTargetUserIds(firstStep, request.RequesterID, stepLookups())
    if (targets.length === 0) {
      // e.g. the target department has no manager assigned — surface it
      await alertUnassignableStep(params.id, firstStep, request.RequesterID, request.Status, request.Status, payload.userId)
    } else {
      const visible = await filterVisibleUserIds(
        targets.filter((id: string) => id !== payload.userId),
        request.FormTemplateID
      )
      if (visible.length > 0) {
        await notifyUsers(visible, {
          title: `Approval needed on ${request.TrackingNumber}`,
          message:
            `${actorName} requested "${wf.Name}" on ${request.TrackingNumber} — your turn at "${firstStep.StepName}"` +
            dueSuffix(dueAt),
          type: 'REQUEST_SUBMITTED',
          requestId: params.id,
        })
      }
    }
    if (notActor(request.RequesterID)) {
      await notifyUsers([request.RequesterID], {
        title: `Approval requested on ${request.TrackingNumber}`,
        message: `${actorName} requested "${wf.Name}" (currently at "${firstStep.StepName}")`,
        type: 'REQUEST_SUBMITTED',
        requestId: params.id,
      })
    }
    return json(run, 201)
  }

  // ---- APPROVE / REJECT ----
  if (action === 'APPROVE' || action === 'REJECT') {
    // a decision on an on-demand approval run — same governance, run-scoped
    if (data!.wfRunId) {
      return await decideRun({
        requestId: params.id,
        runId: data!.wfRunId,
        ctx,
        payload,
        action,
        comment: data!.comment,
        now,
        actorName,
      })
    }
    // No blanket REQUEST_APPROVE clearance here — canUserDecideStep governs:
    // directly-targeted approvers (e.g. department managers) decide without the
    // agent permission; anything else still requires it.
    if (!['PENDING_APPROVAL', 'CLARIFICATION_REQUESTED'].includes(request.Status)) {
      return json({ error: 'Request is not awaiting approval' }, 400)
    }
    if (!request.CurrentWFStepID) return json({ error: 'No active step' }, 400)
    const round = request.Round ?? 1
    const step = await prisma.wFSteps.findUnique({
      where: { WFStepID: request.CurrentWFStepID },
      include: {
        TargetUser: { select: { Name: true } },
        TargetGroup: { select: { Name: true } },
        TargetRole: { select: { Name: true } },
      },
    })
    if (!step) return json({ error: 'Approval step not found' }, 400)
    const priorDecisions: { ApproverUserID: string; Decision: string }[] =
      await prisma.requestApprovals.findMany({
        where: {
          RequestID: params.id,
          WFStepID: request.CurrentWFStepID,
          Round: round,
          Decision: { not: 'PENDING' },
        },
        select: { ApproverUserID: true, Decision: true },
      })
    const verdict = await canUserDecideStep({
      step,
      userId: payload.userId,
      requesterId: request.RequesterID,
      isSuperAdmin: ctx.roleCode === 'SUPER_ADMIN',
      hasApprovePerm: hasPermission(ctx, 'REQUEST_APPROVE'),
      lookups: stepLookups(),
      decidedUserIds: priorDecisions.map((d) => d.ApproverUserID),
    })
    if (!verdict.canDecide) return json({ error: verdict.reason ?? 'You cannot decide this step' }, 403)

    const decision = action === 'APPROVE' ? 'APPROVED' : 'REJECTED'
    // step comment policy — e.g. forcing the manager to explain a send-back
    const cp = step.CommentPolicy ?? 'OPTIONAL'
    const commentRequired =
      cp === 'ALWAYS' || (decision === 'APPROVED' && cp === 'ON_APPROVE') || (decision === 'REJECTED' && cp === 'ON_REJECT')
    if (commentRequired && !(data!.comment ?? '').trim()) {
      return json({ error: `Step "${step.StepName}" requires a comment with this decision` }, 400)
    }
    await prisma.requestApprovals.create({
      data: {
        RequestID: params.id,
        WFStepID: request.CurrentWFStepID,
        ApproverUserID: payload.userId,
        Decision: decision,
        Comment: data!.comment ?? null,
        DecidedAt: now,
        Round: round,
      },
    })

    const wf = request.FormTemplate.Workflow
    const steps = wf?.Steps ?? []
    // sending a step back re-opens it for a fresh round of decisions
    let newRound = round
    const currentIdx = steps.findIndex((s: { WFStepID: string }) => s.WFStepID === request.CurrentWFStepID)
    const stepName = steps[currentIdx]?.StepName ?? 'Approval step'
    const approvalMode: string = step.ApprovalMode ?? 'ANY_ONE'
    const approveAction: string = step.ApproveAction ?? 'CONTINUE'
    const rejectAction: string = step.RejectAction ?? 'REJECT_COMPLETELY'
    const targets = await stepTargetUserIds(step, request.RequesterID, stepLookups())
    const approvedIds = new Set(
      priorDecisions
        .filter((d) => d.Decision === 'APPROVED')
        .map((d) => d.ApproverUserID)
    )
    if (decision === 'APPROVED') approvedIds.add(payload.userId)

    let newStatus = request.Status
    let currentStepId: string | null = request.CurrentWFStepID
    let newDueAt: Date | null = request.CurrentStepDueAt ?? null
    let nextStep: (StepTargetInput & { WFStepID: string; StepName: string; DueDays: number | null }) | null = null
    const skipped: { StepName: string }[] = []
    let stepCompleted = false
    let jumpNote: string | null = null

    if (action === 'REJECT') {
      if (rejectAction === 'RETURN_TO_REQUESTER') {
        // back to draft for correction — history is kept, resubmit opens a new round
        newStatus = 'DRAFT'
        currentStepId = null
        newDueAt = null
      } else if (rejectAction === 'RETURN_TO_PREVIOUS_STEP') {
        const backCtx = await conditionContext(params.id, request.Priority)
        let prev: (StepTargetInput & { WFStepID: string; StepName: string; DueDays: number | null }) | null = null
        for (let i = currentIdx - 1; i >= 0; i--) {
          if (stepApplies(steps[i], backCtx)) {
            prev = steps[i]
            break
          }
        }
        if (prev) {
          newStatus = 'PENDING_APPROVAL'
          currentStepId = prev.WFStepID
          newDueAt = dueAtFrom(prev.DueDays, now)
          nextStep = prev
          newRound = round + 1
        } else {
          // nowhere to send back to — return to the requester instead
          newStatus = 'DRAFT'
          currentStepId = null
          newDueAt = null
        }
      } else {
        newStatus = 'REJECTED'
        currentStepId = null
        newDueAt = null
      }
    } else if (
      approvalMode === 'ALL' &&
      (targets.length === 0
        // [].every() is true — without this guard a step whose approvers vanished
        // would auto-complete and the request would roll straight past it
        ? approvedIds.size === 0
        : !targets.every((t: string) => approvedIds.has(t)))
    ) {
      // waiting on the remaining approvers — the step stays open
      stepCompleted = false
    } else {
      // step completed — route by the step's approve action
      stepCompleted = true
      const jumpTarget =
        approveAction === 'JUMP_TO_STEP'
          ? steps.find(
              (s: { WFStepID: string }) =>
                s.WFStepID === step.ApproveTargetStepID && s.WFStepID !== request.CurrentWFStepID
            ) ?? null
          : null
      if (approveAction === 'APPROVE_COMPLETELY') {
        // fast-track: skip everything left and approve the request
        newStatus = 'APPROVED'
        currentStepId = null
        newDueAt = null
      } else if (jumpTarget) {
        // land exactly on the chosen step
        const targetIdx = steps.findIndex(
          (s: { WFStepID: string }) => s.WFStepID === jumpTarget.WFStepID
        )
        nextStep = jumpTarget
        currentStepId = jumpTarget.WFStepID
        newStatus = 'PENDING_APPROVAL'
        newDueAt = dueAtFrom(jumpTarget.DueDays, now)
        if (targetIdx >= 0 && targetIdx <= currentIdx) newRound = round + 1 // jumping back re-opens review
        jumpNote = `"${stepName}" \u2192 "${jumpTarget.StepName}"`
      } else {
        // CONTINUE (also the fallback when a jump target is gone) — advance to
        // the next applicable step, skipping non-matching ones
        const fwdCtx = await conditionContext(params.id, request.Priority)
        for (let i = currentIdx + 1; i < steps.length; i++) {
          if (stepApplies(steps[i], fwdCtx)) {
            nextStep = steps[i]
            break
          }
          skipped.push(steps[i])
        }
        if (nextStep) {
          currentStepId = nextStep.WFStepID
          newStatus = 'PENDING_APPROVAL'
          newDueAt = dueAtFrom(nextStep.DueDays, now)
        } else {
          // all steps approved
          newStatus = 'APPROVED'
          currentStepId = null
          newDueAt = null
        }
      }
    }

    // TTA — first action taken anywhere on the request
    const ttaPatch = !request.RespondedAt ? { RespondedAt: now } : {}
    // TTR — request reached a final approval verdict
    const ttrPatch =
      !request.ResolvedAt && ['APPROVED', 'REJECTED'].includes(newStatus) ? { ResolvedAt: now } : {}
    const updated = await prisma.requests.update({
      where: { RequestID: params.id },
      data: { Status: newStatus, CurrentWFStepID: currentStepId, CurrentStepDueAt: newDueAt, Round: newRound, ...ttaPatch, ...ttrPatch },
    })
    for (const s of skipped) {
      await prisma.requestAuditLog.create({
        data: { RequestID: params.id, FromStatus: request.Status, ToStatus: newStatus, Action: 'STEP_SKIPPED', ChangedByUserID: payload.userId, Note: `"${s.StepName}" skipped (condition not met, round ${newRound})` },
      })
    }
    const auditAction =
      decision === 'REJECTED'
        ? newStatus === 'DRAFT'
          ? 'RETURNED_TO_REQUESTER'
          : newStatus === 'PENDING_APPROVAL'
            ? 'RETURNED_TO_PREVIOUS'
            : 'REJECTED'
        : 'APPROVED'
    await prisma.requestAuditLog.create({
      data: { RequestID: params.id, FromStatus: request.Status, ToStatus: newStatus, Action: auditAction, ChangedByUserID: payload.userId, Note: data!.comment ?? null },
    })
    if (jumpNote) {
      await prisma.requestAuditLog.create({
        data: { RequestID: params.id, FromStatus: newStatus, ToStatus: newStatus, Action: 'JUMPED_TO_STEP', ChangedByUserID: payload.userId, Note: jumpNote },
      })
    }
    if (notActor(request.RequesterID)) {
      if (decision === 'APPROVED') {
        await notifyUsers([request.RequesterID], {
          title: `Request ${request.TrackingNumber} approved`,
          message: !stepCompleted
            ? `${actorName} approved "${stepName}" (${approvedIds.size} of ${Math.max(targets.length, approvedIds.size)} approvals)`
            : nextStep
              ? `${actorName} approved "${stepName}" — moved to ${nextStep.StepName}`
              : `${actorName} approved "${stepName}" — request fully approved`,
          type: 'REQUEST_APPROVED',
          requestId: params.id,
        })
      } else if (newStatus === 'DRAFT') {
        await notifyUsers([request.RequesterID], {
          title: `Request ${request.TrackingNumber} returned for correction`,
          message: `${actorName} returned "${stepName}"${data!.comment ? ` — ${data!.comment}` : ' — please review and resubmit'}`,
          type: 'REQUEST_REJECTED',
          requestId: params.id,
        })
      } else if (newStatus === 'PENDING_APPROVAL') {
        await notifyUsers([request.RequesterID], {
          title: `Request ${request.TrackingNumber} sent back a step`,
          message: `${actorName} sent "${stepName}" back to ${nextStep?.StepName ?? 'the previous step'}${data!.comment ? ` — ${data!.comment}` : ''}`,
          type: 'REQUEST_REJECTED',
          requestId: params.id,
        })
      } else {
        await notifyUsers([request.RequesterID], {
          title: `Request ${request.TrackingNumber} rejected`,
          message: `${actorName} rejected "${stepName}"${data!.comment ? ` — ${data!.comment}` : ''}`,
          type: 'REQUEST_REJECTED',
          requestId: params.id,
        })
      }
    }
    if (nextStep && newStatus === 'PENDING_APPROVAL') {
      const allNextTargets = await stepTargetUserIds(nextStep, request.RequesterID, stepLookups())
      const nextTargets = allNextTargets.filter((id: string) => id !== payload.userId)
      const visibleNext = await filterVisibleUserIds(nextTargets, request.FormTemplateID)
      // the step is open but nobody owns it -> park it visibly (audit + admin alert)
      if (allNextTargets.length === 0) {
        await alertUnassignableStep(
          params.id, nextStep, request.RequesterID, request.Status, newStatus, payload.userId
        )
      }
      if (visibleNext.length > 0) {
        await notifyUsers(visibleNext, {
          title: 'Request needs your approval',
          message: `${request.TrackingNumber} is now at "${nextStep.StepName}"${dueSuffix(newDueAt)}`,
          type: 'REQUEST_SUBMITTED',
          requestId: params.id,
        })
      }
    }
    // ---- automation rules ----
    if (request.FormTemplate.WFDefinitionID) {
      const wfId = request.FormTemplate.WFDefinitionID
      const condCtx2 = await conditionContext(params.id, updated.Priority)
      const base = { wfDefinitionId: wfId, requestId: params.id, condCtx: condCtx2, actorName, excludeUserIds: [payload.userId] }
      const stepRes = await runWorkflowRules({
        ...base,
        trigger: decision === 'APPROVED' ? 'ON_STEP_APPROVED' : 'ON_STEP_REJECTED',
        // lets the executor run only the automations bound to this step
        stepOrder: step.StepOrder,
      })
      await auditRuleResults(params.id, updated.Status, updated.Status, payload.userId, stepRes)
      if (newStatus === 'APPROVED' || newStatus === 'REJECTED') {
        const finalRes = await runWorkflowRules({
          ...base,
          trigger: newStatus === 'APPROVED' ? 'ON_REQUEST_APPROVED' : 'ON_REQUEST_REJECTED',
        })
        await auditRuleResults(params.id, updated.Status, updated.Status, payload.userId, finalRes)
      }
    }
    const fresh = await prisma.requests.findUnique({ where: { RequestID: params.id } })
    return json(fresh ?? updated)
  }

  // ---- REQUEST_CLARIFICATION ----
  if (action === 'REQUEST_CLARIFICATION') {
    // Targeted approvers (incl. department managers) may ask for clarification too
    if (request.Status !== 'PENDING_APPROVAL') {
      return json({ error: 'Only pending requests can be sent back for clarification' }, 400)
    }
    {
      const step = request.CurrentWFStepID
        ? await prisma.wFSteps.findUnique({
            where: { WFStepID: request.CurrentWFStepID },
            include: {
              TargetUser: { select: { Name: true } },
              TargetGroup: { select: { Name: true } },
              TargetRole: { select: { Name: true } },
            },
          })
        : null
      const verdict = await canUserDecideStep({
        step,
        userId: payload.userId,
        requesterId: request.RequesterID,
        isSuperAdmin: ctx.roleCode === 'SUPER_ADMIN',
        hasApprovePerm: hasPermission(ctx, 'REQUEST_APPROVE'),
        lookups: stepLookups(),
      })
      if (!verdict.canDecide) return json({ error: verdict.reason ?? 'You cannot decide this step' }, 403)
    }
    const msg = data!.comment?.trim()
    if (!msg) return json({ error: 'Please write what you need clarified' }, 400)

    await prisma.requestComments.create({
      data: {
        RequestID: params.id,
        AuthorUserID: payload.userId,
        CommentText: msg,
        CommentType: 'CLARIFICATION',
        IsInternal: false,
      },
    })
    const updated = await prisma.requests.update({
      where: { RequestID: params.id },
      data: { Status: 'CLARIFICATION_REQUESTED' },
    })
    await prisma.requestAuditLog.create({
      data: {
        RequestID: params.id,
        FromStatus: request.Status,
        ToStatus: updated.Status,
        Action: 'CLARIFICATION_REQUESTED',
        ChangedByUserID: payload.userId,
        Note: msg.slice(0, 200),
      },
    })
    if (notActor(request.RequesterID)) {
      await notifyUsers([request.RequesterID], {
        title: `Clarification needed on ${request.TrackingNumber}`,
        message: `${actorName} asked: ${msg.slice(0, 140)}`,
        type: 'CLARIFICATION_REQUESTED',
        requestId: params.id,
      })
    }
    return json(updated)
  }

  // ---- UPDATE_DRAFT ----
  // Edit a draft (or a request returned for correction): scalars + answers + items.
  // File answers are preserved (files are managed through the attachments API).
  if (action === 'UPDATE_DRAFT') {
    if (request.RequesterID !== payload.userId && ctx.roleCode !== 'SUPER_ADMIN') return forbidden()
    if (request.Status !== 'DRAFT') return json({ error: 'Only draft requests can be edited' }, 400)

    const tmplFields: { FormFieldID: string; FieldType: string; Config: string | null }[] =
      await prisma.formFields.findMany({
        where: { FormTemplateID: request.FormTemplateID },
        select: { FormFieldID: true, FieldType: true, Config: true },
      })
    const fieldById = new Map(tmplFields.map((f) => [f.FormFieldID, f]))

    const patch: Record<string, unknown> = {}
    if (data!.title !== undefined) patch.Title = data!.title?.trim() ? data!.title.trim() : null
    if (data!.priority) patch.Priority = data!.priority
    if (data!.neededByDate !== undefined) {
      if (data!.neededByDate) {
        const dt = new Date(data!.neededByDate)
        if (isNaN(dt.getTime())) return json({ error: 'Invalid neededByDate' }, 400)
        patch.NeededByDate = dt
      } else {
        patch.NeededByDate = null
      }
    }

    if (data!.fieldValues) {
      const editable = new Set(
        tmplFields
          .filter((f) => f.FieldType !== 'file' && f.FieldType !== 'section')
          .map((f) => f.FormFieldID)
      )
      for (const fv of data!.fieldValues) {
        if (!editable.has(fv.fieldId)) return json({ error: 'Unknown or locked form field' }, 400)
      }
      // formats are validated now; required-presence is enforced at submit time
      for (const fv of data!.fieldValues) {
        if (fv.value === '') continue
        const f = fieldById.get(fv.fieldId)!
        const reason = validateFieldValue(f.FieldType, fv.value, parseFieldConfig(f.Config))
        if (reason) return json({ error: `A field value is invalid: ${reason}` }, 400)
      }
      await prisma.requestFieldValues.deleteMany({
        where: { RequestID: params.id, FormFieldID: { in: Array.from(editable) } },
      })
      const rows = data!.fieldValues.filter((fv) => fv.value !== '')
      if (rows.length > 0) {
        await prisma.requestFieldValues.createMany({
          data: rows.map((fv) => ({ RequestID: params.id, FormFieldID: fv.fieldId, Value: fv.value })),
        })
      }
    }

    if (data!.items) {
      const itemsFieldIds = new Set(
        tmplFields.filter((f) => f.FieldType === 'items').map((f) => f.FormFieldID)
      )
      for (const it of data!.items) {
        if (it.fieldId && !itemsFieldIds.has(it.fieldId)) {
          return json({ error: 'An item is bound to an unknown items field' }, 400)
        }
      }
      const existing: {
        RequestItemID: string
        ItemVerifiedByUserID: string | null
        IssuedFromStockQuantity: unknown
      }[] = await prisma.requestItems.findMany({ where: { RequestID: params.id } })
      const existingIds = new Set(existing.map((e) => e.RequestItemID))
      const incomingIds = new Set<string>()
      for (const it of data!.items) {
        if (it.id) {
          if (!existingIds.has(it.id)) return json({ error: 'Unknown item' }, 400)
          incomingIds.add(it.id)
        }
      }
      for (const e of existing) {
        if (!incomingIds.has(e.RequestItemID)) {
          if (e.ItemVerifiedByUserID || Number(e.IssuedFromStockQuantity ?? 0) > 0) {
            return json({ error: 'Cannot remove an item that is already being fulfilled' }, 400)
          }
          await prisma.requestItems.delete({ where: { RequestItemID: e.RequestItemID } })
        }
      }
      for (const it of data!.items) {
        const row = {
          FormFieldID: it.fieldId ?? null,
          RequestedItemName: it.name.trim(),
          RequestedItemDetails: it.details?.trim() ? it.details.trim() : null,
          RequestedUom: it.uom?.trim() ? it.uom.trim() : null,
          RequestedQuantity: it.quantity,
          ItemCatalogCacheID: it.catalogId ?? null,
          OracleItemID: it.oracleItemId ?? null,
          ItemCode: it.itemCode ?? null,
          ItemName: it.itemName ?? null,
          Uom: it.itemUom ?? null,
          OrganizationCode: it.orgCode ?? null,
          EstimatedPrice: it.estimatedPrice ?? null,
        }
        if (it.id) {
          await prisma.requestItems.update({ where: { RequestItemID: it.id }, data: row })
        } else {
          await prisma.requestItems.create({ data: { ...row, RequestID: params.id } })
        }
      }
    }

    const updated =
      Object.keys(patch).length > 0
        ? await prisma.requests.update({ where: { RequestID: params.id }, data: patch })
        : request
    await prisma.requestAuditLog.create({
      data: { RequestID: params.id, FromStatus: request.Status, ToStatus: updated.Status, Action: 'DRAFT_UPDATED', ChangedByUserID: payload.userId },
    })
    return json(updated)
  }

  // ---- ASSIGN ----
  if (action === 'ASSIGN') {
    if (!hasPermission(ctx, 'REQUEST_ASSIGN')) return forbidden()
    if (!data!.assigneeId) return json({ error: 'assigneeId required' }, 400)
    const updated = await prisma.requests.update({
      where: { RequestID: params.id },
      data: { AssigneeID: data!.assigneeId },
    })
    await prisma.requestAuditLog.create({
      data: { RequestID: params.id, FromStatus: request.Status, ToStatus: updated.Status, Action: 'ASSIGN', ChangedByUserID: payload.userId, Note: `Assigned to ${data!.assigneeId}` },
    })
    if (notActor(data!.assigneeId)) {
      await notifyUsers([data!.assigneeId!], {
        title: `Request ${request.TrackingNumber} assigned to you`,
        message: `${actorName} assigned this request to you`,
        type: 'REQUEST_ASSIGNED',
        requestId: params.id,
      })
    }
    return json(updated)
  }

  // ---- REGISTER_PO ----
  if (action === 'REGISTER_PO') {
    if (!hasPermission(ctx, 'REQUEST_REGISTER_PO')) return forbidden()
    if (!data!.oraclePoNumber) return json({ error: 'oraclePoNumber required' }, 400)
    const updated = await prisma.requests.update({
      where: { RequestID: params.id },
      data: {
        OraclePoNumber: data!.oraclePoNumber,
        PoCreatedByUserID: payload.userId,
        PoCreatedAt: now,
        PoNotes: data!.poNotes ?? null,
        Status: 'PO_REGISTERED',
      },
    })
    await prisma.requestAuditLog.create({
      data: { RequestID: params.id, FromStatus: request.Status, ToStatus: updated.Status, Action: 'PO_REGISTERED', ChangedByUserID: payload.userId, Note: `PO: ${data!.oraclePoNumber}` },
    })
    if (notActor(request.RequesterID)) {
      await notifyUsers([request.RequesterID], {
        title: `PO registered for ${request.TrackingNumber}`,
        message: `${actorName} registered Oracle PO ${data!.oraclePoNumber}`,
        type: 'PO_REGISTERED',
        requestId: params.id,
      })
    }
    return json(updated)
  }

  // ---- FULFILL_STOCK ----
  if (action === 'FULFILL_STOCK') {
    if (!hasPermission(ctx, 'REQUEST_FULFILL')) return forbidden()
    const updated = await prisma.requests.update({
      where: { RequestID: params.id },
      data: { Status: 'FULFILLED', CompletedAt: now },
    })
    await prisma.requestAuditLog.create({
      data: { RequestID: params.id, FromStatus: request.Status, ToStatus: updated.Status, Action: 'FULFILL', ChangedByUserID: payload.userId },
    })
    if (notActor(request.RequesterID)) {
      await notifyUsers([request.RequesterID], {
        title: `Request ${request.TrackingNumber} fulfilled`,
        message: `${actorName} marked this request as fulfilled`,
        type: 'REQUEST_FULFILLED',
        requestId: params.id,
      })
    }
    return json(updated)
  }

  // ---- COMPLETE ----
  if (action === 'COMPLETE') {
    if (!hasPermission(ctx, 'REQUEST_FULFILL')) return forbidden()
    const updated = await prisma.requests.update({
      where: { RequestID: params.id },
      data: { Status: 'COMPLETED', CompletedAt: now },
    })
    await prisma.requestAuditLog.create({
      data: { RequestID: params.id, FromStatus: request.Status, ToStatus: updated.Status, Action: 'COMPLETE', ChangedByUserID: payload.userId },
    })
    if (notActor(request.RequesterID)) {
      await notifyUsers([request.RequesterID], {
        title: `Request ${request.TrackingNumber} completed`,
        message: `${actorName} closed this request as completed`,
        type: 'REQUEST_COMPLETED',
        requestId: params.id,
      })
    }
    return json(updated)
  }

  // ---- CANCEL ----
  if (action === 'CANCEL') {
    if (request.RequesterID !== payload.userId && ctx.roleCode !== 'SUPER_ADMIN') return forbidden()
    if (!['DRAFT', 'PENDING_APPROVAL', 'CLARIFICATION_REQUESTED'].includes(request.Status)) {
      return json({ error: 'This request can no longer be cancelled' }, 400)
    }
    const updated = await prisma.requests.update({
      where: { RequestID: params.id },
      data: { Status: 'CANCELLED', ...(!request.ResolvedAt ? { ResolvedAt: now } : {}) },
    })
    await prisma.requestAuditLog.create({
      data: { RequestID: params.id, FromStatus: request.Status, ToStatus: updated.Status, Action: 'CANCEL', ChangedByUserID: payload.userId },
    })
    if (notActor(request.RequesterID)) {
      await notifyUsers([request.RequesterID], {
        title: `Request ${request.TrackingNumber} cancelled`,
        message: `${actorName} cancelled this request`,
        type: 'REQUEST_CANCELLED',
        requestId: params.id,
      })
    }
    return json(updated)
  }

  // ---- SET_PRIORITY ----
  if (action === 'SET_PRIORITY') {
    if (!hasPermission(ctx, 'REQUEST_ASSIGN') && ctx.roleCode !== 'SUPER_ADMIN') return forbidden()
    if (!data!.priority) return json({ error: 'priority required' }, 400)
    if (['CANCELLED', 'COMPLETED', 'FULFILLED'].includes(request.Status)) {
      return json({ error: 'Cannot change priority of a closed request' }, 400)
    }
    const updated = await prisma.requests.update({
      where: { RequestID: params.id },
      data: { Priority: data!.priority },
    })
    await prisma.requestAuditLog.create({
      data: {
        RequestID: params.id,
        FromStatus: request.Status,
        ToStatus: updated.Status,
        Action: 'PRIORITY_CHANGED',
        ChangedByUserID: payload.userId,
        Note: `${request.Priority} → ${data!.priority}`,
      },
    })
    return json(updated)
  }

  return json({ error: 'Unknown action' }, 400)
}
