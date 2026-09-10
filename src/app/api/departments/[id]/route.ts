import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, error, unauthorized, forbidden, notFound, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

interface Params { params: { id: string } }

// GET /api/departments/[id] — detail + members
export async function GET(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()

  const dep = await prisma.dEP.findUnique({
    where: { DEPID: params.id },
    select: {
      DEPID: true, Name: true, Code: true, CreatedAt: true,
      Manager: { select: { UserID: true, Name: true, Email: true } },
    },
  })
  if (!dep) return notFound('Department not found')

  const members = await prisma.users.findMany({
    where: { DEPID: params.id },
    select: {
      UserID: true, Name: true, Email: true, IsActive: true,
      Role: { select: { Name: true } },
    },
    orderBy: { Name: 'asc' },
  })
  return json({ ...dep, members })
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  managerId: z.string().nullable().optional(),
})

// PUT /api/departments/[id] (DEP_MANAGE)
export async function PUT(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'DEP_MANAGE')) return forbidden()

  const { data, error: err } = await parseBody(req, updateSchema)
  if (err) return error(err!)

  const existing = await prisma.dEP.findUnique({ where: { DEPID: params.id } })
  if (!existing) return notFound('Department not found')

  const update: Record<string, unknown> = {}
  if (data!.name) update.Name = data!.name.trim()
  if (data!.code) {
    const code = data!.code.trim().toUpperCase()
    const clash = await prisma.dEP.findFirst({ where: { Code: code, NOT: { DEPID: params.id } } })
    if (clash) return error('A department with this code already exists', 409)
    update.Code = code
  }
  if (data!.managerId !== undefined) {
    if (data!.managerId) {
      const mgr = await prisma.users.findUnique({ where: { UserID: data!.managerId } })
      if (!mgr) return error('Selected manager does not exist', 400)
      const alreadyLeads = await prisma.dEP.findFirst({
        where: { ManagerID: data!.managerId, NOT: { DEPID: params.id } },
      })
      if (alreadyLeads) return error(`This user already manages "${alreadyLeads.Name}"`, 409)
    }
    update.ManagerID = data!.managerId
  }

  const dep = await prisma.dEP.update({
    where: { DEPID: params.id },
    data: update,
    select: {
      DEPID: true, Name: true, Code: true,
      Manager: { select: { UserID: true, Name: true } },
    },
  })
  return json(dep)
}

// DELETE /api/departments/[id] (DEP_MANAGE)
export async function DELETE(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'DEP_MANAGE')) return forbidden()

  const existing = await prisma.dEP.findUnique({ where: { DEPID: params.id } })
  if (!existing) return notFound('Department not found')

  const memberCount = await prisma.users.count({ where: { DEPID: params.id } })
  if (memberCount > 0)
    return error(`Cannot delete: ${memberCount} member(s) still belong to this department. Reassign them first.`, 409)

  try {
    await prisma.dEP.delete({ where: { DEPID: params.id } })
  } catch {
    return error('Cannot delete: this department is referenced by forms, workflows or requests.', 409)
  }
  return json({ success: true })
}
