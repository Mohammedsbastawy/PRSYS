import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, error, unauthorized, forbidden, notFound, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

interface Params { params: { id: string } }

// GET /api/groups/[id]
export async function GET(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()

  const g = await prisma.groups.findUnique({
    where: { GroupID: params.id },
    include: {
      Members: { include: { UserRef: { select: { UserID: true, Name: true, Email: true, IsActive: true, DEPID: true } } } },
      _count: { select: { WFSteps: true, FormPerms: true } },
    },
  })
  if (!g) return notFound('Group not found')

  const deps = await prisma.dEP.findMany({ select: { DEPID: true, Name: true } })
  const depMap = new Map(deps.map((d) => [d.DEPID, d.Name]))
  return json({
    id: g.GroupID,
    name: g.Name,
    description: g.Description,
    workflowCount: g._count.WFSteps,
    formPermCount: g._count.FormPerms,
    members: g.Members.map((m) => ({
      UserID: m.UserRef.UserID,
      Name: m.UserRef.Name,
      Email: m.UserRef.Email,
      IsActive: m.UserRef.IsActive,
      department: m.UserRef.DEPID ? (depMap.get(m.UserRef.DEPID) ?? null) : null,
    })),
  })
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
})

// PUT /api/groups/[id] (GROUP_MANAGE)
export async function PUT(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'GROUP_MANAGE')) return forbidden()

  const { data, error: err } = await parseBody(req, updateSchema)
  if (err) return error(err!)

  const existing = await prisma.groups.findUnique({ where: { GroupID: params.id } })
  if (!existing) return notFound('Group not found')

  const update: Record<string, unknown> = {}
  if (data!.name) update.Name = data!.name.trim()
  if (data!.description !== undefined) update.Description = data!.description?.trim() || null

  const group = await prisma.groups.update({ where: { GroupID: params.id }, data: update })
  return json({ id: group.GroupID, name: group.Name, description: group.Description })
}

// DELETE /api/groups/[id] (GROUP_MANAGE) — blocked while referenced by workflows / form permissions
export async function DELETE(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'GROUP_MANAGE')) return forbidden()

  const existing = await prisma.groups.findUnique({
    where: { GroupID: params.id },
    include: { _count: { select: { WFSteps: true, FormPerms: true, OwnedTemplates: true } } },
  })
  if (!existing) return notFound('Group not found')

  const wf = existing._count.WFSteps
  const fp = existing._count.FormPerms
  if (wf > 0 || fp > 0) {
    const parts = []
    if (wf) parts.push(`${wf} workflow step(s)`)
    if (fp) parts.push(`${fp} form permission(s)`)
    return error(`Cannot delete: this group is used in ${parts.join(' and ')}. Remove those references first.`, 409)
  }

  try {
    await prisma.$transaction([
      prisma.groupMembers.deleteMany({ where: { GroupID: params.id } }),
      prisma.groups.delete({ where: { GroupID: params.id } }),
    ])
  } catch {
    return error('Cannot delete: this group is referenced by other records.', 409)
  }
  return json({ success: true })
}
