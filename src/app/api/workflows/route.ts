import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

const stepSchema = z.object({
  stepName: z.string().min(1),
  stepOrder: z.number().int(),
  approverType: z.string(), // USER | GROUP | ROLE | MANAGER
  targetUserId: z.string().optional().nullable(),
  targetGroupId: z.string().optional().nullable(),
  targetRoleId: z.string().optional().nullable(),
  approvalMode: z.string().default('ANY_ONE'), // ANY_ONE | ALL
  rejectAction: z.string().default('REJECT_COMPLETELY'),
  condition: z.string().optional().nullable(),
})

const wfSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  status: z.string().default('ACTIVE'),
  steps: z.array(stepSchema).default([]),
})

// GET /api/workflows
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const wfs = await prisma.wFDefinitions.findMany({
    include: { Steps: { orderBy: { StepOrder: 'asc' } }, Templates: { select: { FormTemplateID: true, Name: true } } },
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

  const wf = await prisma.wFDefinitions.create({
    data: {
      Name: data!.name,
      Description: data!.description ?? null,
      Status: data!.status,
      Steps: {
        create: (data!.steps ?? []).map((s) => ({
          StepName: s.stepName,
          StepOrder: s.stepOrder,
          ApproverType: s.approverType,
          TargetUserID: s.targetUserId || null,
          TargetGroupID: s.targetGroupId || null,
          TargetRoleID: s.targetRoleId || null,
          ApprovalMode: s.approvalMode,
          RejectAction: s.rejectAction,
          Condition: s.condition || null,
        })),
      },
    },
    include: { Steps: true },
  })
  return json(wf, 201)
}
