import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, notFound, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { notifyUsers, usersWithPermission } from '@/lib/notifications'
import { canUserDecideStep, describeStepTarget, stepTargetUserIds } from '@/lib/workflow-targets'
import type { StepLookups } from '@/lib/workflow-targets'
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

  // can the viewer decide the current step?
  let canDecide = false
  let decideReason: string | null = null
  let awaitingTarget: string | null = null
  if (['PENDING_APPROVAL', 'CLARIFICATION_REQUESTED'].includes(request.Status) && request.CurrentStep) {
    awaitingTarget = describeStepTarget(request.CurrentStep)
    const verdict = await canUserDecideStep({
      step: request.CurrentStep,
      userId: payload.userId,
      requesterId: request.RequesterID,
      isSuperAdmin: ctx.roleCode === 'SUPER_ADMIN',
      hasApprovePerm: hasPermission(ctx, 'REQUEST_APPROVE'),
      lookups: stepLookups(),
    })
    canDecide = verdict.canDecide
    decideReason = verdict.reason
  }

  return json({ ...request, RequesterDepartment: department, Comments: comments, Attachments: attachments, CanDecide: canDecide, DecideReason: decideReason, AwaitingTarget: awaitingTarget })
}

// PATCH /api/requests/[id] — status transitions
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
  ]),
  comment: z.string().optional().nullable(),
  assigneeId: z.string().optional().nullable(),
  oraclePoNumber: z.string().optional().nullable(),
  poNotes: z.string().optional().nullable(),
  decision: z.string().optional(), // APPROVED | REJECTED
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

    // validate required template fields
    const requiredFields = await prisma.formFields.findMany({
      where: { FormTemplateID: request.FormTemplateID, IsRequired: true },
    })
    if (requiredFields.length > 0) {
      const vals = await prisma.requestFieldValues.findMany({
        where: { RequestID: params.id },
        select: { FormFieldID: true, Value: true },
      })
      const missing = requiredFields.filter(
        (f) => !vals.some((v) => v.FormFieldID === f.FormFieldID && v.Value.trim() !== '')
      )
      if (missing.length > 0) {
        return json({ error: `Missing required fields: ${missing.map((m) => m.Label).join(', ')}` }, 400)
      }
    }
    const itemCount = await prisma.requestItems.count({ where: { RequestID: params.id } })
    if (itemCount === 0) return json({ error: 'Add at least one item before submitting' }, 400)

    const wf = request.FormTemplate.Workflow
    const firstStep = wf?.Steps[0]
    const update: Record<string, unknown> = {
      Status: firstStep ? 'PENDING_APPROVAL' : 'APPROVED',
      SubmittedAt: now,
      CurrentWFStepID: firstStep?.WFStepID ?? null,
    }
    const updated = await prisma.requests.update({ where: { RequestID: params.id }, data: update })
    await prisma.requestAuditLog.create({
      data: { RequestID: params.id, FromStatus: request.Status, ToStatus: updated.Status, Action: 'SUBMIT', ChangedByUserID: payload.userId },
    })
    const firstTargets = firstStep
      ? await stepTargetUserIds(firstStep, request.RequesterID, stepLookups())
      : []
    const approvers = (
      firstTargets.length > 0 ? firstTargets : await usersWithPermission('REQUEST_APPROVE')
    ).filter((id) => id !== payload.userId)
    await notifyUsers(approvers, {
      title: 'New request needs approval',
      message: `${request.Requester.Name} submitted ${request.TrackingNumber} (${request.FormTemplate.Name})`,
      type: 'REQUEST_SUBMITTED',
      requestId: params.id,
    })
    return json(updated)
  }

  // ---- APPROVE / REJECT ----
  if (action === 'APPROVE' || action === 'REJECT') {
    if (!hasPermission(ctx, 'REQUEST_APPROVE')) return forbidden()
    if (!['PENDING_APPROVAL', 'CLARIFICATION_REQUESTED'].includes(request.Status)) {
      return json({ error: 'Request is not awaiting approval' }, 400)
    }
    if (!request.CurrentWFStepID) return json({ error: 'No active step' }, 400)
    {
      const step = await prisma.wFSteps.findUnique({
        where: { WFStepID: request.CurrentWFStepID },
        include: {
          TargetUser: { select: { Name: true } },
          TargetGroup: { select: { Name: true } },
          TargetRole: { select: { Name: true } },
        },
      })
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

    const decision = action === 'APPROVE' ? 'APPROVED' : 'REJECTED'
    await prisma.requestApprovals.create({
      data: {
        RequestID: params.id,
        WFStepID: request.CurrentWFStepID,
        ApproverUserID: payload.userId,
        Decision: decision,
        Comment: data!.comment ?? null,
        DecidedAt: now,
      },
    })

    const wf = request.FormTemplate.Workflow
    const steps = wf?.Steps ?? []
    const currentIdx = steps.findIndex((s) => s.WFStepID === request.CurrentWFStepID)
    const stepName = steps[currentIdx]?.StepName ?? 'Approval step'
    const nextStep = steps[currentIdx + 1]

    let newStatus = request.Status
    let currentStepId: string | null = request.CurrentWFStepID
    if (action === 'REJECT') {
      newStatus = 'REJECTED'
      currentStepId = null
    } else if (nextStep) {
      currentStepId = nextStep.WFStepID
      newStatus = 'PENDING_APPROVAL'
    } else {
      // all steps approved
      newStatus = 'APPROVED'
      currentStepId = null
    }

    const updated = await prisma.requests.update({
      where: { RequestID: params.id },
      data: { Status: newStatus, CurrentWFStepID: currentStepId },
    })
    await prisma.requestAuditLog.create({
      data: { RequestID: params.id, FromStatus: request.Status, ToStatus: newStatus, Action: decision, ChangedByUserID: payload.userId, Note: data!.comment ?? null },
    })
    if (notActor(request.RequesterID)) {
      await notifyUsers(
        [request.RequesterID],
        decision === 'APPROVED'
          ? {
              title: `Request ${request.TrackingNumber} approved`,
              message: nextStep
                ? `${actorName} approved "${stepName}" — moved to ${nextStep.StepName}`
                : `${actorName} approved "${stepName}" — request fully approved`,
              type: 'REQUEST_APPROVED',
              requestId: params.id,
            }
          : {
              title: `Request ${request.TrackingNumber} rejected`,
              message: `${actorName} rejected "${stepName}"${data!.comment ? ` — ${data!.comment}` : ''}`,
              type: 'REQUEST_REJECTED',
              requestId: params.id,
            }
      )
    }
    if (decision === 'APPROVED' && nextStep) {
      const nextTargets = (
        await stepTargetUserIds(nextStep, request.RequesterID, stepLookups())
      ).filter((id: string) => id !== payload.userId)
      if (nextTargets.length > 0) {
        await notifyUsers(nextTargets, {
          title: 'Request needs your approval',
          message: `${request.TrackingNumber} is now at "${nextStep.StepName}"`,
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
