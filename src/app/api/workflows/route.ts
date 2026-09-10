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
  approverType: z.enum(['ANY_APPROVER', 'ROLE', 'GROUP', 'USER', 'REQUESTER_MANAGER', 'DEPARTMENT_MANAGER']),
  targetUserId: z.string().optional().nullable(),
  targetGroupId: z.string().optional().nullable(),
  targetRoleId: z.string().optional().nullable(),
  approvalMode: z.enum(['ANY_ONE', 'ALL']).default('ANY_ONE'),
  rejectAction: z.enum(['REJECT_COMPLETELY', 'RETURN_TO_REQUESTER', 'RETURN_TO_PREVIOUS_STEP']).default('REJECT_COMPLETELY'),
  condition: conditionSchema,
  dueDays: z.number().int().min(1).max(365).optional().nullable(),
  approveAction: z.enum(['CONTINUE', 'APPROVE_COMPLETELY', 'JUMP_TO_STEP']).default('CONTINUE'),
  approveTargetIndex: z.number().int().min(1).max(100).optional().nullable(),
  commentPolicy: z.enum(['OPTIONAL', 'ON_APPROVE', 'ON_REJECT', 'ALWAYS']).default('OPTIONAL'),
})

const ruleSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(150),
  trigger: z.enum(['ON_SUBMIT', 'ON_STEP_APPROVED', 'ON_STEP_REJECTED', 'ON_REQUEST_APPROVED', 'ON_REQUEST_REJECTED']),
  condition: conditionSchema,
  action: z.enum(['SET_PRIORITY', 'ASSIGN_TO_USER', 'NOTIFY', 'JUMP_TO_STEP']),
  actionValue: z.object({
    priority: z.string().optional(),
    userId: z.string().optional(),
    notifyTargetType: z.enum(['USER', 'GROUP', 'ROLE', 'DEPARTMENT_MANAGER', 'REQUESTER']).optional(),
    notifyTargetId: z.string().optional().nullable(),
    notifyTitle: z.string().max(150).optional(),
    notifyMessage: z.string().max(500).optional(),
    jumpToStepOrder: z.number().int().min(0).max(100).optional(),
  }).default({}),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
})

const wfSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(500).optional().nullable(),
  status: z.enum(['ACTIVE', 'DRAFT']).default('ACTIVE'),
  steps: z.array(stepSchema).default([]),
  rules: z.array(ruleSchema).default([]),
})

type StepInput = {
  stepName: string
  approverType: 'ANY_APPROVER' | 'ROLE' | 'GROUP' | 'USER' | 'REQUESTER_MANAGER' | 'DEPARTMENT_MANAGER'
  targetUserId?: string | null
  targetGroupId?: string | null
  targetRoleId?: string | null
  approvalMode?: 'ANY_ONE' | 'ALL'
  rejectAction?: 'REJECT_COMPLETELY' | 'RETURN_TO_REQUESTER' | 'RETURN_TO_PREVIOUS_STEP'
  condition?: { field: 'totalValue' | 'itemCount' | 'priority'; op: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'in'; value: string } | null
  dueDays?: number | null
  approveAction?: 'CONTINUE' | 'APPROVE_COMPLETELY' | 'JUMP_TO_STEP'
  approveTargetIndex?: number | null
  commentPolicy?: 'OPTIONAL' | 'ON_APPROVE' | 'ON_REJECT' | 'ALWAYS'
}

type RuleInput = {
  name: string
  trigger: 'ON_SUBMIT' | 'ON_STEP_APPROVED' | 'ON_STEP_REJECTED' | 'ON_REQUEST_APPROVED' | 'ON_REQUEST_REJECTED'
  condition?: { field: 'totalValue' | 'itemCount' | 'priority'; op: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'in'; value: string } | null
  action: 'SET_PRIORITY' | 'ASSIGN_TO_USER' | 'NOTIFY' | 'JUMP_TO_STEP'
  actionValue?: {
    priority?: string
    userId?: string
    notifyTargetType?: 'USER' | 'GROUP' | 'ROLE' | 'DEPARTMENT_MANAGER' | 'REQUESTER'
    notifyTargetId?: string | null
    notifyTitle?: string
    notifyMessage?: string
    jumpToStepOrder?: number
  }
  sortOrder?: number
  isActive?: boolean
}

function validateRules(rules: RuleInput[], stepCount: number): string | null {
  for (const r of rules) {
    if (!r.name.trim()) return 'Every rule needs a name'
    if (r.condition) {
      const cErr = validateConditionInput(r.condition.field, r.condition.op, r.condition.value)
      if (cErr) return `Rule "${r.name}": ${cErr}`
    }
    const v = r.actionValue ?? {}
    if (r.action === 'SET_PRIORITY' && !['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(v.priority ?? ''))
      return `Rule "${r.name}": choose a priority`
    if (r.action === 'ASSIGN_TO_USER' && !v.userId) return `Rule "${r.name}": choose a user`
    if (r.action === 'JUMP_TO_STEP' && (typeof v.jumpToStepOrder !== 'number' || v.jumpToStepOrder < 0 || v.jumpToStepOrder >= stepCount))
      return `Rule "${r.name}": jump target is out of range`
    if (r.action === 'NOTIFY') {
      if (!v.notifyTargetType) return `Rule "${r.name}": choose who to notify`
      if (['USER', 'GROUP', 'ROLE'].includes(v.notifyTargetType) && !v.notifyTargetId)
        return `Rule "${r.name}": choose the notify target`
    }
  }
  return null
}

function ruleRow(r: RuleInput, order: number) {
  return {
    Name: r.name.trim(),
    Trigger: r.trigger,
    Condition: r.condition ? buildStepCondition(r.condition.field, r.condition.op, r.condition.value) : null,
    Action: r.action,
    ActionValue: JSON.stringify(r.actionValue ?? {}),
    SortOrder: r.sortOrder ?? order,
    IsActive: r.isActive ?? true,
  }
}

async function validateSteps(steps: StepInput[]): Promise<string | null> {
  for (let idx = 0; idx < steps.length; idx++) {
    const s = steps[idx]
    if (!s.stepName.trim()) return 'Every step needs a name'
    if (s.condition) {
      const cErr = validateConditionInput(s.condition.field, s.condition.op, s.condition.value)
      if (cErr) return `Step "${s.stepName}": ${cErr}`
    }
    if (s.approveAction === 'JUMP_TO_STEP') {
      if (!s.approveTargetIndex) return `Step "${s.stepName}": choose a step to jump to`
      if (s.approveTargetIndex < 1 || s.approveTargetIndex > steps.length) {
        return `Step "${s.stepName}": jump target is out of range`
      }
      if (s.approveTargetIndex === idx + 1) return `Step "${s.stepName}": cannot jump to itself`
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
    CommentPolicy: s.commentPolicy ?? 'OPTIONAL',
    ApproveAction: s.approveAction ?? 'CONTINUE',
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
      Rules: { orderBy: { SortOrder: 'asc' } },
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
  const ruleErr = validateRules(data!.rules ?? [], (data!.steps ?? []).length)
  if (ruleErr) return json({ error: ruleErr }, 400)

  const wf = await prisma.wFDefinitions.create({
    data: {
      Name: data!.name.trim(),
      Description: data!.description ?? null,
      Status: data!.status,
      Steps: {
        create: (data!.steps ?? []).map((s, i) => stepRow(s, i)),
      },
      Rules: {
        create: (data!.rules ?? []).map((r, i) => ruleRow(r, i)),
      },
    },
    include: { Steps: true },
  })
  // resolve jump targets now that every step has an ID
  const incoming = data!.steps ?? []
  if (incoming.some((s) => s.approveAction === 'JUMP_TO_STEP')) {
    const created = await prisma.wFSteps.findMany({
      where: { WFDefinitionID: wf.WFDefinitionID },
      orderBy: { StepOrder: 'asc' },
    })
    for (let i = 0; i < incoming.length; i++) {
      const s = incoming[i]
      if (s.approveAction === 'JUMP_TO_STEP' && s.approveTargetIndex) {
        await prisma.wFSteps.update({
          where: { WFStepID: created[i].WFStepID },
          data: { ApproveTargetStepID: created[s.approveTargetIndex - 1].WFStepID },
        })
      }
    }
  }
  return json(wf, 201)
}
