import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, error, unauthorized, forbidden, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

const targetSchema = z.object({
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  responseMins: z.number().int().min(0).max(525600),
  resolveMins: z.number().int().min(0).max(525600),
})

const policySchema = z.object({
  name: z.string().min(1, 'Policy name is required').max(100),
  description: z.string().max(300).optional().nullable(),
  isDefault: z.boolean().default(false),
  targets: z.array(targetSchema).default([]),
})

// GET /api/sla-policies — list with targets & usage
// Readable by SLA_MANAGE and by form/workflow managers (they need it for dropdowns)
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx) return unauthorized()
  const allowed =
    hasPermission(ctx, 'SLA_MANAGE') ||
    hasPermission(ctx, 'FORM_TEMPLATE_MANAGE') ||
    hasPermission(ctx, 'WF_MANAGE') ||
    ctx.roleCode === 'SUPER_ADMIN'
  if (!allowed) return forbidden()

  const policies = await prisma.sLAPolicies.findMany({
    include: {
      Targets: { orderBy: { Priority: 'asc' } },
      _count: { select: { Templates: true } },
    },
    orderBy: [{ IsDefault: 'desc' }, { Name: 'asc' }],
  })
  return json(
    policies.map((p) => ({
      id: p.SLAPolicyID,
      name: p.Name,
      description: p.Description,
      isDefault: p.IsDefault,
      templateCount: p._count.Templates,
      targets: p.Targets.map((t) => ({
        priority: t.Priority,
        responseMins: t.ResponseMins,
        resolveMins: t.ResolveMins,
      })),
    }))
  )
}

// POST /api/sla-policies (SLA_MANAGE)
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'SLA_MANAGE')) return forbidden()

  const { data, error: err } = await parseBody(req, policySchema)
  if (err) return error(err!)

  const clash = await prisma.sLAPolicies.findUnique({ where: { Name: data!.name.trim() } })
  if (clash) return error('A policy with this name already exists', 409)

  const name = data!.name.trim()
  const description = data!.description?.trim() || null
  const isDefault = data!.isDefault
  const targets = data!.targets ?? []
  if (targets.length === 0) return error('Define at least one priority target')

  const policy = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.sLAPolicies.updateMany({ where: { IsDefault: true }, data: { IsDefault: false } })
    }
    return tx.sLAPolicies.create({
      data: {
        Name: name,
        Description: description,
        IsDefault: isDefault,
        Targets: {
          create: targets.map((t) => ({
            Priority: t.priority,
            ResponseMins: t.responseMins,
            ResolveMins: t.resolveMins,
          })),
        },
      },
    })
  })
  return json({ id: policy.SLAPolicyID, name: policy.Name }, 201)
}
