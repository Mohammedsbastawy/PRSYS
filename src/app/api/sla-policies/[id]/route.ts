import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, error, unauthorized, forbidden, notFound, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

interface Params { params: { id: string } }

const targetSchema = z.object({
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  responseMins: z.number().int().min(0).max(525600),
  resolveMins: z.number().int().min(0).max(525600),
})

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(300).nullable().optional(),
  isDefault: z.boolean().optional(),
  targets: z.array(targetSchema).optional(),
})

// PUT /api/sla-policies/[id] (SLA_MANAGE)
export async function PUT(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'SLA_MANAGE')) return forbidden()

  const { data, error: err } = await parseBody(req, updateSchema)
  if (err) return error(err!)

  const existing = await prisma.sLAPolicies.findUnique({ where: { SLAPolicyID: params.id } })
  if (!existing) return notFound('SLA policy not found')

  if (data!.name) {
    const clash = await prisma.sLAPolicies.findFirst({
      where: { Name: data!.name.trim(), NOT: { SLAPolicyID: params.id } },
    })
    if (clash) return error('A policy with this name already exists', 409)
  }

  await prisma.$transaction(async (tx) => {
    if (data!.isDefault) {
      await tx.sLAPolicies.updateMany({
        where: { IsDefault: true, NOT: { SLAPolicyID: params.id } },
        data: { IsDefault: false },
      })
    }
    await tx.sLAPolicies.update({
      where: { SLAPolicyID: params.id },
      data: {
        ...(data!.name ? { Name: data!.name.trim() } : {}),
        ...(data!.description !== undefined ? { Description: data!.description?.trim() || null } : {}),
        ...(data!.isDefault !== undefined ? { IsDefault: data!.isDefault } : {}),
      },
    })
    if (data!.targets) {
      await tx.sLATargets.deleteMany({ where: { SLAPolicyID: params.id } })
      for (const t of data!.targets) {
        await tx.sLATargets.create({
          data: { SLAPolicyID: params.id, Priority: t.priority, ResponseMins: t.responseMins, ResolveMins: t.resolveMins },
        })
      }
    }
  })
  return json({ success: true })
}

// DELETE /api/sla-policies/[id] (SLA_MANAGE) — templates/requests detach via SetNull
export async function DELETE(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'SLA_MANAGE')) return forbidden()

  const existing = await prisma.sLAPolicies.findUnique({
    where: { SLAPolicyID: params.id },
    include: { _count: { select: { Templates: true, Requests: true } } },
  })
  if (!existing) return notFound('SLA policy not found')

  const { Templates, Requests: onRequests } = existing._count
  try {
    await prisma.sLAPolicies.delete({ where: { SLAPolicyID: params.id } })
  } catch {
    return error('Cannot delete this policy — it is referenced by existing data.', 409)
  }
  return json({ success: true, detachedTemplates: Templates, affectedRequests: onRequests })
}
