import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, notFound, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { buildStepCondition, validateConditionInput } from '@/lib/workflow-conditions'
import { z } from 'zod'

const conditionSchema = z.object({
  field: z.enum(['totalValue', 'itemCount', 'priority']),
  op: z.enum(['==', '!=', '>', '<', '>=', '<=', 'in']),
  value: z.string().min(1).max(100),
}).nullable().optional()

interface Params { params: { id: string } }

const stepInclude = {
  TargetUser: { select: { Name: true } },
  TargetGroup: { select: { Name: true } },
  TargetRole: { select: { Name: true } },
}

// GET /api/workflows/[id]
export async function GET(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()

  const wf = await prisma.wFDefinitions.findUnique({
    where: { WFDefinitionID: params.id },
    include: {
      Steps: { include: stepInclude, orderBy: { StepOrder: 'asc' } },
      Templates: { select: { FormTemplateID: true, Name: true, Status: true } },
    },
  })
  if (!wf) return notFound('Workflow not found')

  const stepIds = wf.Steps.map((s) => s.WFStepID)
  const [liveRequests, decisions] = await Promise.all([
    stepIds.length ? prisma.requests.count({ where: { CurrentWFStepID: { in: stepIds } } }) : 0,
    stepIds.length ? prisma.requestApprovals.count({ where: { WFStepID: { in: stepIds } } }) : 0,
  ])
  return json({
    ...wf,
    usage: { templates: wf.Templates.length, liveRequests, decisions },
  })
}

const stepSchema = z.object({
  id: z.string().optional(), // WFStepID for existing steps; absent = new step
  stepName: z.string().min(1).max(120),
  stepOrder: z.number().int().default(0),
  approverType: z.enum(['ANY_APPROVER', 'ROLE', 'GROUP', 'USER', 'REQUESTER_MANAGER']),
  targetUserId: z.string().optional().nullable(),
  targetGroupId: z.string().optional().nullable(),
  targetRoleId: z.string().optional().nullable(),
  approvalMode: z.enum(['ANY_ONE', 'ALL']).default('ANY_ONE'),
  rejectAction: z.enum(['REJECT_COMPLETELY', 'RETURN_TO_REQUESTER', 'RETURN_TO_PREVIOUS_STEP']).default('REJECT_COMPLETELY'),
  condition: conditionSchema,
  dueDays: z.number().int().min(1).max(365).optional().nullable(),
})

const wfSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(500).optional().nullable(),
  status: z.enum(['ACTIVE', 'DRAFT']).default('ACTIVE'),
  steps: z.array(stepSchema).default([]),
})

type StepInput = {
  stepName: string
  approverType: 'ANY_APPROVER' | 'ROLE' | 'GROUP' | 'USER' | 'REQUESTER_MANAGER'
  targetUserId?: string | null
  targetGroupId?: string | null
  targetRoleId?: string | null
  approvalMode?: 'ANY_ONE' | 'ALL'
  rejectAction?: 'REJECT_COMPLETELY' | 'RETURN_TO_REQUESTER' | 'RETURN_TO_PREVIOUS_STEP'
  condition?: { field: 'totalValue' | 'itemCount' | 'priority'; op: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'in'; value: string } | null
  dueDays?: number | null
}

async function validateSteps(steps: StepInput[]): Promise<string | null> {
  for (const s of steps) {
    if (!s.stepName.trim()) return 'Every step needs a name'
    if (s.condition) {
      const cErr = validateConditionInput(s.condition.field, s.condition.op, s.condition.value)
      if (cErr) return `Step "${s.stepName}": ${cErr}`
    }
    if (s.approverType === 'ROLE') {
      if (!s.targetRoleId) return `Step "${s.stepName}": choose a role`
      const r = await prisma.roles.findUnique({ where: { RoleID: s.targetRoleId }, select: { RoleID: true } })
      if (!r) return `Step "${s.stepName}": role not found`
    }
    if (s.approverType === 'GROUP') {
      if (!s.targetGroupId) return `Step "${s.stepName}": choose a group`
      const g = await prisma.groups.findUnique({ where: { GroupID: s.targetGroupId }, select: { GroupID: true } })
      if (!g) return `Step "${s.stepName}": group not found`
    }
    if (s.approverType === 'USER') {
      if (!s.targetUserId) return `Step "${s.stepName}": choose a user`
      const u = await prisma.users.findUnique({ where: { UserID: s.targetUserId }, select: { UserID: true } })
      if (!u) return `Step "${s.stepName}": user not found`
    }
  }
  return null
}

// PUT /api/workflows/[id] — full update (settings + steps merge)
export async function PUT(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'WF_MANAGE')) return forbidden()

  const { data, error: err } = await parseBody(req, wfSchema)
  if (err) return json({ error: err }, 400)
  const steps = data!.steps ?? []

  const stepErr = await validateSteps(steps)
  if (stepErr) return json({ error: stepErr }, 400)

  const existing = await prisma.wFDefinitions.findUnique({
    where: { WFDefinitionID: params.id },
    include: { Steps: { select: { WFStepID: true } } },
  })
  if (!existing) return notFound('Workflow not found')

  const existingIds = new Set<string>(existing.Steps.map((s: { WFStepID: string }) => s.WFStepID))
  const incomingIds = new Set<string>()
  for (const s of steps) {
    if (s.id) {
      if (!existingIds.has(s.id)) return json({ error: 'Unknown step id' }, 400)
      incomingIds.add(s.id)
    }
  }
  const toDelete = Array.from(existingIds).filter((id) => !incomingIds.has(id))

  // steps with live requests or past decisions cannot be removed
  if (toDelete.length > 0) {
    const live = await prisma.requests.count({ where: { CurrentWFStepID: { in: toDelete } } })
    if (live > 0) {
      return json({ error: `Cannot remove a step with ${live} live request(s) on it` }, 409)
    }
    const decided = await prisma.requestApprovals.count({ where: { WFStepID: { in: toDelete } } })
    if (decided > 0) {
      return json({ error: 'Cannot remove a step that already has approval decisions' }, 409)
    }
  }

  await prisma.$transaction(async (tx) => {
    if (toDelete.length > 0) {
      await tx.wFSteps.deleteMany({ where: { WFStepID: { in: toDelete } } })
    }
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]
      const row = {
        StepName: s.stepName.trim(),
        StepOrder: i,
        ApproverType: s.approverType,
        TargetUserID: s.approverType === 'USER' ? s.targetUserId! : null,
        TargetGroupID: s.approverType === 'GROUP' ? s.targetGroupId! : null,
        TargetRoleID: s.approverType === 'ROLE' ? s.targetRoleId! : null,
        ApprovalMode: s.approvalMode ?? 'ANY_ONE',
        RejectAction: s.rejectAction ?? 'REJECT_COMPLETELY',
        Condition: s.condition ? buildStepCondition(s.condition.field, s.condition.op, s.condition.value) : null,
        DueDays: s.dueDays ?? null,
      }
      if (s.id) {
        await tx.wFSteps.update({ where: { WFStepID: s.id }, data: row })
      } else {
        await tx.wFSteps.create({
          data: { ...row, WFDefinitionID: params.id },
        })
      }
    }
    await tx.wFDefinitions.update({
      where: { WFDefinitionID: params.id },
      data: {
        Name: data!.name.trim(),
        Description: data!.description ?? null,
        Status: data!.status,
      },
    })
  })

  const wf = await prisma.wFDefinitions.findUnique({
    where: { WFDefinitionID: params.id },
    include: { Steps: { include: stepInclude, orderBy: { StepOrder: 'asc' } } },
  })
  return json(wf)
}

// DELETE /api/workflows/[id] — blocked while in use
export async function DELETE(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'WF_MANAGE')) return forbidden()

  const wf = await prisma.wFDefinitions.findUnique({
    where: { WFDefinitionID: params.id },
    include: {
      Steps: { select: { WFStepID: true } },
      _count: { select: { Templates: true } },
    },
  })
  if (!wf) return notFound('Workflow not found')
  if (wf._count.Templates > 0) {
    return json(
      { error: `Cannot delete "${wf.Name}": ${wf._count.Templates} form template(s) use it` },
      409
    )
  }
  const stepIds = wf.Steps.map((s) => s.WFStepID)
  if (stepIds.length > 0) {
    const live = await prisma.requests.count({ where: { CurrentWFStepID: { in: stepIds } } })
    if (live > 0) {
      return json({ error: `Cannot delete "${wf.Name}": ${live} live request(s) are on its steps` }, 409)
    }
    const decided = await prisma.requestApprovals.count({ where: { WFStepID: { in: stepIds } } })
    if (decided > 0) {
      return json({ error: `Cannot delete "${wf.Name}": its steps have approval history` }, 409)
    }
  }
  await prisma.wFDefinitions.delete({ where: { WFDefinitionID: params.id } })
  return json({ ok: true })
}
