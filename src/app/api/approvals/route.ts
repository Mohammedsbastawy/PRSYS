import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { usersWithPermission } from '@/lib/notifications'
import { canUserDecideStep, describeStepTarget, type StepLookups } from '@/lib/workflow-targets'

const PENDING_STATUSES = ['PENDING_APPROVAL', 'CLARIFICATION_REQUESTED']

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

// GET /api/approvals?mode=pending|history&type=<categoryId>&dept=<depId>&q=<text>&sort=oldest|newest|value&countOnly=1
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'REQUEST_APPROVE')) return forbidden()

  const url = new URL(req.url)
  const mode = url.searchParams.get('mode') || 'pending'

  // ---- History: my past approve/reject decisions ----
  if (mode === 'history') {
    const rows = await prisma.requestApprovals.findMany({
      where: { ApproverUserID: payload.userId, Decision: { in: ['APPROVED', 'REJECTED'] } },
      include: {
        Request: {
          select: {
            RequestID: true,
            TrackingNumber: true,
            Title: true,
            Status: true,
            Requester: { select: { Name: true } },
            FormTemplate: { select: { Name: true } },
          },
        },
        WFStep: { select: { StepName: true } },
      },
      orderBy: { DecidedAt: 'desc' },
      take: 200,
    })
    return json(
      rows.map((r) => ({
        id: r.RequestApprovalID,
        decision: r.Decision,
        comment: r.Comment,
        decidedAt: r.DecidedAt,
        stepName: r.WFStep?.StepName ?? '—',
        request: {
          id: r.Request.RequestID,
          tracking: r.Request.TrackingNumber,
          title: r.Request.Title,
          status: r.Request.Status,
          requester: r.Request.Requester?.Name ?? '—',
          form: r.Request.FormTemplate?.Name ?? '—',
        },
      }))
    )
  }

  // ---- Pending queue: everything awaiting a decision ----
  const type = url.searchParams.get('type') || ''
  const dept = url.searchParams.get('dept') || ''
  const q = url.searchParams.get('q')?.trim() || ''
  const sort = url.searchParams.get('sort') || 'oldest'

  const where: Record<string, unknown> = { Status: { in: PENDING_STATUSES } }
  if (type) where.FormTemplate = { FormCategoryID: type }
  if (dept) where.Requester = { DEPID: dept }
  if (q) {
    where.OR = [
      { TrackingNumber: { contains: q } },
      { Title: { contains: q } },
      { Requester: { Name: { contains: q } } },
    ]
  }

  if (url.searchParams.get('countOnly') === '1') {
    return json({ count: await prisma.requests.count({ where }) })
  }

  const rows = await prisma.requests.findMany({
    where,
    include: {
      Requester: { select: { Name: true, DEPID: true } },
      FormTemplate: {
        select: {
          Name: true,
          Category: { select: { Name: true } },
          Workflow: { select: { Steps: { select: { WFStepID: true }, orderBy: { StepOrder: 'asc' } } } },
        },
      },
      CurrentStep: {
        select: {
          WFStepID: true,
          StepName: true,
          ApproverType: true,
          TargetUserID: true,
          TargetGroupID: true,
          TargetRoleID: true,
          TargetUser: { select: { Name: true } },
          TargetGroup: { select: { Name: true } },
          TargetRole: { select: { Name: true } },
        },
      },
      Items: { select: { RequestedQuantity: true, EstimatedPrice: true } },
    },
    take: 200,
  })

  // Users.DEPID is a plain scalar (no relation), so resolve department names in one extra query
  const depIds = Array.from(
    new Set(rows.map((r) => r.Requester?.DEPID).filter((d): d is string => !!d))
  )
  const deps = depIds.length
    ? await prisma.dEP.findMany({ where: { DEPID: { in: depIds } }, select: { DEPID: true, Name: true } })
    : []
  const depName = new Map(deps.map((d) => [d.DEPID, d.Name]))

  const lookups = stepLookups()
  const isSuperAdmin = ctx.roleCode === 'SUPER_ADMIN'
  const now = Date.now()
  const items = []
  for (const r of rows) {
    const steps = r.FormTemplate?.Workflow?.Steps ?? []
    const idx = r.CurrentWFStepID ? steps.findIndex((s) => s.WFStepID === r.CurrentWFStepID) : -1
    const submitted = r.SubmittedAt ?? r.CreatedAt
    const verdict = await canUserDecideStep({
      step: r.CurrentStep,
      userId: payload.userId,
      requesterId: r.RequesterID,
      isSuperAdmin,
      hasApprovePerm: true,
      lookups,
    })
    items.push({
      id: r.RequestID,
      tracking: r.TrackingNumber,
      title: r.Title,
      status: r.Status,
      priority: r.Priority,
      submittedAt: submitted,
      daysPending: Math.max(0, Math.floor((now - new Date(submitted).getTime()) / 86400000)),
      requester: r.Requester?.Name ?? '—',
      department: r.Requester?.DEPID
        ? { id: r.Requester.DEPID, name: depName.get(r.Requester.DEPID) ?? '—' }
        : null,
      type: r.FormTemplate?.Category?.Name ?? r.FormTemplate?.Name ?? '—',
      stepName: r.CurrentStep?.StepName ?? null,
      stepIndex: idx,
      stepCount: steps.length,
      itemCount: r.Items.length,
      totalValue: r.Items.reduce(
        (sum, it) => sum + Number(it.RequestedQuantity ?? 0) * Number(it.EstimatedPrice ?? 0),
        0
      ),
      canDecide: verdict.canDecide,
      decideReason: verdict.reason,
      awaiting: r.CurrentStep ? describeStepTarget(r.CurrentStep) : null,
    })
  }

  items.sort((a, b) => {
    if (sort === 'newest') return +new Date(b.submittedAt) - +new Date(a.submittedAt)
    if (sort === 'value') {
      return b.totalValue - a.totalValue || +new Date(a.submittedAt) - +new Date(b.submittedAt)
    }
    return +new Date(a.submittedAt) - +new Date(b.submittedAt) // oldest first
  })
  return json(items)
}
