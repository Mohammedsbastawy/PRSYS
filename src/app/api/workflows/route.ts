import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { buildStepCondition, validateConditionInput } from '@/lib/workflow-conditions'
import { z } from 'zod'

const conditionSchema = z.object({
  field: z.enum(['totalValue', 'itemCount', 'priority']),
  op: z.enum(['==', '!=', '>', '<', '>=', '<=', 'in']),
  value: z.string().min(1).max(100),
}).nullable().optional()

const stepSchema = z.object({
  id: z.string().optional(), // present on update, ignored on create
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

function stepRow(s: StepInput, order: number) {
  return {
    StepName: s.stepName.trim(),
    StepOrder: order,
    ApproverType: s.approverType,
    TargetUserID: s.approverType === 'USER' ? s.targetUserId! : null,
    TargetGroupID: s.approverType === 'GROUP' ? s.targetGroupId! : null,
    TargetRoleID: s.approverType === 'ROLE' ? s.targetRoleId! : null,
    ApprovalMode: s.approvalMode ?? 'ANY_ONE',
    RejectAction: s.rejectAction ?? 'REJECT_COMPLETELY',
    Condition: s.condition ? buildStepCondition(s.condition.field, s.condition.op, s.condition.value) : null,
    DueDays: s.dueDays ?? null,
  }
}

// GET /api/workflows
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const wfs = await prisma.wFDefinitions.findMany({
    include: {
      Steps: {
        include: {
          TargetUser: { select: { Name: true } },
          TargetGroup: { select: { Name: true } },
          TargetRole: { select: { Name: true } },
        },
        orderBy: { StepOrder: 'asc' },
      },
      Templates: { select: { FormTemplateID: true, Name: true, Status: true } },
      _count: { select: { Templates: true } },
    },
    orderBy: { CreatedAt: 'desc' },
  })
  return json(wfs)
}

// POST /api/workflows
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'WF_MANAGE')) return forbidden()

  const { data, error: err } = await parseBody(req, wfSchema)
  if (err) return json({ error: err }, 400)

  const stepErr = await validateSteps(data!.steps ?? [])
  if (stepErr) return json({ error: stepErr }, 400)

  const wf = await prisma.wFDefinitions.create({
    data: {
      Name: data!.name.trim(),
      Description: data!.description ?? null,
      Status: data!.status,
      Steps: {
        create: (data!.steps ?? []).map((s, i) => stepRow(s, i)),
      },
    },
    include: { Steps: true },
  })
  return json(wf, 201)
}
