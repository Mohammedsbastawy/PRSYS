import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, notFound, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { notifyUsers, usersWithPermission } from '@/lib/notifications'
import { canUserDecideStep, describeStepTarget, stepTargetUserIds } from '@/lib/workflow-targets'
import type { StepLookups, StepTargetInput } from '@/lib/workflow-targets'
import { parseFieldConfig, isValueEmpty, validateFieldValue, parseMultiValue, formatMoney } from '@/lib/field-config'
import { parseStepCondition, evaluateStepCondition } from '@/lib/workflow-conditions'
import type { ConditionContext } from '@/lib/workflow-conditions'
import { z } from 'zod'

interface Params { params: { id: string } }

// Resolves step targets (role members, group members, specific user, manager, all approvers)
function stepLookups(): StepLookups {
  return {
    usersWithRole: async (roleId) => {
      const rows = await prisma.users.findMany({
        where: { RoleID: roleId, IsActive: true },
        select: { UserID: true },
      })
      return rows.map((r: { UserID: string }) => r.UserID)
    },
    groupMembers: async (groupId) => {
      const rows = await prisma.groupMembers.findMany({
        where: { GroupID: groupId },
        select: { UserID: true },
      })
      return rows.map((r: { UserID: string }) => r.UserID)
    },
    requesterManager: async (requesterId) => {
      const u = await prisma.users.findUnique({
        where: { UserID: requesterId },
        select: { DirectManagerID: true },
      })
      return u?.DirectManagerID ?? null
    },
    allApprovers: () => usersWithPermission('REQUEST_APPROVE'),
  }
}

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

// Fresh due date when a request enters a step (null = no due date on the step)
function dueAtFrom(dueDays: number | null | undefined, from: Date): Date | null {
  if (!dueDays || dueDays <= 0) return null
  return new Date(from.getTime() + dueDays * 86400000)
}

function dueSuffix(dueAt: Date | null): string {
  if (!dueAt) return ''
  return ` (due ${dueAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
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
        },
      },
      Requester: { select: { UserID: true, Name: true, Email: true, DEPID: true } },
      Assignee: { select: { UserID: true, Name: true } },
      PoCreator: { select: { UserID: true, Name: true } },
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

  // visibility check
  const isOwner = request.RequesterID === payload.userId
  if (!isOwner && !hasPermission(ctx, 'REQUEST_VIEW_ALL')) {
    return forbidden()
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

  return json({ ...request, RequesterDepartment: department, Comments: comments, Attachments: attachments, FieldValues: fieldValues, CanDecide: canDecide, DecideReason: decideReason, AwaitingTarget: awaitingTarget, StepProgress: stepProgress })
}

// PATCH /api/requests/[id] — status transitions
const draftItemSchema = z.object({
  id: z.string().optional().nullable(), // present = update row, absent = new row
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
    'REQUEST_CLARIFICATION',
    'ASSIGN',
    'REGISTER_PO',
    'FULFILL_STOCK',
    'COMPLETE',
    'CANCEL',
    'UPDATE_DRAFT',
  ]),
  comment: z.string().optional().nullable(),
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
      const missing: string[] = []
      for (const f of tmplFields) {
        if (f.FieldType === 'section') continue
        const raw = byField.get(f.FormFieldID) ?? ''
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
    if (itemCount === 0) return json({ error: 'Add at least one item before submitting' }, 400)

    const wf = request.FormTemplate.Workflow
    const steps = wf?.Steps ?? []
    // resubmits open a fresh round so old decisions stay as history only
    const newRound = request.SubmittedAt ? (request.Round ?? 1) + 1 : (request.Round ?? 1)
    const condCtx = await conditionContext(params.id, request.Priority)
    const skipped: { StepName: string }[] = []
    let firstStep: (StepTargetInput & { WFStepID: string; DueDays: number | null }) | null = null
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
    const approvers = (
      firstTargets.length > 0 ? firstTargets : await usersWithPermission('REQUEST_APPROVE')
    ).filter((id) => id !== payload.userId)
    await notifyUsers(approvers, {
      title: 'New request needs approval',
      message: `${request.Requester.Name} submitted ${request.TrackingNumber} (${request.FormTemplate.Name})${dueSuffix(firstDueAt)}`,
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
    return json(updated)
  }

  // ---- APPROVE / REJECT ----
  if (action === 'APPROVE' || action === 'REJECT') {
    if (!hasPermission(ctx, 'REQUEST_APPROVE')) return forbidden()
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
    } else if (approvalMode === 'ALL' && !targets.every((t) => approvedIds.has(t))) {
      // waiting on the remaining approvers — the step stays open
      stepCompleted = false
    } else {
      // step completed — advance to the next applicable step, skipping non-matching ones
      stepCompleted = true
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

    const updated = await prisma.requests.update({
      where: { RequestID: params.id },
      data: { Status: newStatus, CurrentWFStepID: currentStepId, CurrentStepDueAt: newDueAt, Round: newRound },
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
      const nextTargets = (
        await stepTargetUserIds(nextStep, request.RequesterID, stepLookups())
      ).filter((id: string) => id !== payload.userId)
      if (nextTargets.length > 0) {
        await notifyUsers(nextTargets, {
          title: 'Request needs your approval',
          message: `${request.TrackingNumber} is now at "${nextStep.StepName}"${dueSuffix(newDueAt)}`,
          type: 'REQUEST_SUBMITTED',
          requestId: params.id,
        })
      }
    }
    return json(updated)
  }

  // ---- REQUEST_CLARIFICATION ----
  if (action === 'REQUEST_CLARIFICATION') {
    if (!hasPermission(ctx, 'REQUEST_APPROVE')) return forbidden()
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
      data: { Status: 'CANCELLED' },
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

  return json({ error: 'Unknown action' }, 400)
}
