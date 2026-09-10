import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { canUserDecideStep, describeStepTarget, stepTargetUserIds } from '@/lib/workflow-targets'
import { stepLookups } from '@/lib/workflow-targets-prisma'

const PENDING_STATUSES = ['PENDING_APPROVAL', 'CLARIFICATION_REQUESTED']

// GET /api/approvals?mode=pending|history&type=<categoryId>&dept=<depId>&q=<text>&sort=oldest|newest|value&countOnly=1
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx) return forbidden()
  const canApprove = hasPermission(ctx, 'REQUEST_APPROVE')
  // Department manager is an assignment, not a role — managers get a scoped approvals queue
  const managedDeps = await prisma.dEP.findMany({
    where: { ManagerID: payload.userId },
    select: { DEPID: true },
  })
  if (!canApprove && managedDeps.length === 0) return forbidden()

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
  // pure managers (no agent permission) see only their managed departments' queue
  if (!canApprove) {
    if (dept && !managedDeps.some((d) => d.DEPID === dept)) {
      return json(url.searchParams.get('countOnly') === '1' ? { count: 0 } : [])
    }
    where.Requester = where.Requester ?? { DEPID: { in: managedDeps.map((d) => d.DEPID) } }
  }
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
          ApprovalMode: true,
          DueDays: true,
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

  // my past decisions on these requests (one decision per step per round)
  const rowIds = rows.map((r: { RequestID: string }) => r.RequestID)
  const myDecisions: { RequestID: string; WFStepID: string; Round: number }[] =
    rowIds.length > 0
      ? await prisma.requestApprovals.findMany({
          where: {
            ApproverUserID: payload.userId,
            RequestID: { in: rowIds },
            Decision: { not: 'PENDING' },
          },
          select: { RequestID: true, WFStepID: true, Round: true },
        })
      : []
  const myDecidedKeys = new Set(
    myDecisions.map((d) => `${d.RequestID}|${d.WFStepID}|${d.Round ?? 1}`)
  )
  // approvals collected per (request, step, round) for ALL-mode progress
  const progressRows: { RequestID: string; WFStepID: string; Round: number; ApproverUserID: string }[] =
    rowIds.length > 0
      ? await prisma.requestApprovals.findMany({
          where: { RequestID: { in: rowIds }, Decision: 'APPROVED' },
          select: { RequestID: true, WFStepID: true, Round: true, ApproverUserID: true },
        })
      : []
  const approvalCount = new Map<string, Set<string>>()
  for (const p of progressRows) {
    const key = `${p.RequestID}|${p.WFStepID}|${p.Round ?? 1}`
    if (!approvalCount.has(key)) approvalCount.set(key, new Set())
    approvalCount.get(key)!.add(p.ApproverUserID)
  }

  const items = []
  for (const r of rows) {
    const steps = r.FormTemplate?.Workflow?.Steps ?? []
    const idx = r.CurrentWFStepID ? steps.findIndex((s) => s.WFStepID === r.CurrentWFStepID) : -1
    const submitted = r.SubmittedAt ?? r.CreatedAt
    const roundKey = `${r.RequestID}|${r.CurrentWFStepID}|${r.Round ?? 1}`
    const verdict = await canUserDecideStep({
      step: r.CurrentStep,
      userId: payload.userId,
      requesterId: r.RequesterID,
      isSuperAdmin,
      hasApprovePerm: canApprove,
      lookups,
      decidedUserIds: myDecidedKeys.has(roundKey) ? [payload.userId] : [],
    })
    let progress: { approved: number; total: number } | null = null
    if (r.CurrentStep?.ApprovalMode === 'ALL' && r.CurrentWFStepID) {
      const approved = approvalCount.get(roundKey)?.size ?? 0
      const targets = await stepTargetUserIds(r.CurrentStep, r.RequesterID, lookups)
      progress = { approved, total: Math.max(targets.length, approved) }
    }
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
      dueAt: r.CurrentStepDueAt ?? null,
      approvalMode: r.CurrentStep?.ApprovalMode ?? 'ANY_ONE',
      progress,
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
