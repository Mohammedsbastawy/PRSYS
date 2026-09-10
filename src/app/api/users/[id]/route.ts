import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, error, unauthorized, forbidden, notFound, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

interface Params { params: { id: string } }

// GET /api/users/[id]
export async function GET(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'USER_VIEW')) return forbidden()

  const user = await prisma.users.findUnique({
    where: { UserID: params.id },
    select: {
      UserID: true, Name: true, Email: true, AccountType: true, IsActive: true,
      Role: { select: { RoleID: true, Code: true, Name: true } },
      ManagedDEP: { select: { DEPID: true, Name: true } },
      Manager: { select: { UserID: true, Name: true } },
      Subordinates: { select: { UserID: true, Name: true } },
    },
  })
  if (!user) return notFound('User not found')
  return json(user)
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  roleId: z.string().min(1).optional(),
  depId: z.string().nullable().optional(),
  managerId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
})

// PUT /api/users/[id]
export async function PUT(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'USER_EDIT')) return forbidden()

  const { data, error: err } = await parseBody(req, updateSchema)
  if (err) return error(err)

  const existing = await prisma.users.findUnique({ where: { UserID: params.id } })
  if (!existing) return notFound('User not found')

  const update: Record<string, unknown> = {}
  if (data!.name) update.Name = data!.name
  if (data!.email) update.Email = data!.email
  if (data!.roleId) update.RoleID = data!.roleId
  if (data!.depId !== undefined) update.DEPID = data!.depId
  if (data!.managerId !== undefined) update.DirectManagerID = data!.managerId
  if (data!.isActive !== undefined) update.IsActive = data!.isActive
  if (data!.password) {
    const bcrypt = (await import('bcryptjs')).default
    update.PasswordHash = await bcrypt.hash(data!.password, 10)
  }

  const user = await prisma.users.update({
    where: { UserID: params.id },
    data: update,
    select: { UserID: true, Name: true, Email: true, IsActive: true, RoleID: true },
  })
  return json(user)
}

// DELETE /api/users/[id]
export async function DELETE(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'USER_DELETE')) return forbidden()

  if (params.id === payload.userId) return error('Cannot delete yourself', 400)

  const existing = await prisma.users.findUnique({ where: { UserID: params.id } })
  if (!existing) return notFound('User not found')

  await prisma.users.delete({ where: { UserID: params.id } })
  return json({ success: true })
}
