import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, notFound, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { notifyUsers, usersWithPermission } from '@/lib/notifications'
import { z } from 'zod'

interface Params { params: { id: string } }

// GET /api/requests/[id]
export async function GET(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx) return forbidden()

  const request = await prisma.requests.findUnique({
    where: { RequestID: params.id },
    include: {
      FormTemplate: true,
      Requester: { select: { UserID: true, Name: true, Email: true } },
      Assignee: { select: { UserID: true, Name: true } },
      CurrentStep: true,
      FieldValues: { include: { FormField: true } },
      Items: true,
      Approvals: { include: { WFStep: true, Approver: { select: { UserID: true, Name: true } } }, orderBy: { CreatedAt: 'asc' } },
      Comments: { include: { Author: { select: { UserID: true, Name: true } } }, orderBy: { CreatedAt: 'asc' } },
      Attachments: true,
      AuditLogs: { orderBy: { CreatedAt: 'asc' } },
    },
  })
  if (!request) return notFound('Request not found')

  // visibility check
  if (request.RequesterID !== payload.userId && !hasPermission(ctx, 'REQUEST_VIEW_ALL')) {
    return forbidden()
  }
  return json(request)
}

// PATCH /api/requests/[id] — status transitions: submit, approve, reject, register-po, complete
const actionSchema = z.object({
  action: z.enum(['SUBMIT', 'APPROVE', 'REJECT', 'ASSIGN', 'REGISTER_PO', 'FULFILL_STOCK', 'COMPLETE', 'CANCEL']),
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
    const approvers = (await usersWithPermission('REQUEST_APPROVE')).filter((id) => id !== payload.userId)
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
    if (!request.CurrentWFStepID) return json({ error: 'No active step' }, 400)

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
