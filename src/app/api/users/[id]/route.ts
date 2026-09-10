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
      DEPID: true, RoleID: true, DirectManagerID: true, CreatedAt: true,
      Role: { select: { RoleID: true, Code: true, Name: true } },
      ManagedDEP: { select: { DEPID: true, Name: true } },
      Manager: { select: { UserID: true, Name: true } },
      Subordinates: { select: { UserID: true, Name: true } },
      GroupMembers: { select: { GroupRef: { select: { GroupID: true, Name: true } } } },
    },
  })
  if (!user) return notFound('User not found')
  const { GroupMembers, ...rest } = user
  return json({ ...rest, Groups: GroupMembers.map((m) => m.GroupRef) })
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6, 'Password must be at least 6 characters').optional(),
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
  if (err) return error(err!)

  const existing = await prisma.users.findUnique({ where: { UserID: params.id } })
  if (!existing) return notFound('User not found')

  // Safety rails — an admin cannot lock themselves out
  const isSelf = params.id === payload.userId
  if (isSelf && data!.isActive === false) return error('You cannot deactivate your own account', 400)
  if (isSelf && data!.roleId && data!.roleId !== existing.RoleID)
    return error('You cannot change your own role', 400)
  if (data!.managerId === params.id) return error('A user cannot manage themselves', 400)

  const update: Record<string, unknown> = {}
  if (data!.name) update.Name = data!.name.trim()
  if (data!.email) {
    const email = data!.email.trim().toLowerCase()
    const clash = await prisma.users.findFirst({ where: { Email: email, NOT: { UserID: params.id } } })
    if (clash) return error('A user with this email already exists', 409)
    update.Email = email
  }
  if (data!.roleId) {
    const role = await prisma.roles.findUnique({ where: { RoleID: data!.roleId } })
    if (!role) return error('Selected role does not exist', 400)
    update.RoleID = data!.roleId
  }
  if (data!.depId !== undefined) {
    if (data!.depId) {
      const dep = await prisma.dEP.findUnique({ where: { DEPID: data!.depId } })
      if (!dep) return error('Selected department does not exist', 400)
    }
    update.DEPID = data!.depId
  }
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

  if (params.id === payload.userId) return error('You cannot delete your own account', 400)

  const existing = await prisma.users.findUnique({ where: { UserID: params.id } })
  if (!existing) return notFound('User not found')

  try {
    await prisma.$transaction([
      prisma.groupMembers.deleteMany({ where: { UserID: params.id } }),
      prisma.users.updateMany({ where: { DirectManagerID: params.id }, data: { DirectManagerID: null } }),
      prisma.dEP.updateMany({ where: { ManagerID: params.id }, data: { ManagerID: null } }),
      prisma.users.delete({ where: { UserID: params.id } }),
    ])
  } catch {
    // FK constraints (requests, approvals, audit…) — advise soft-delete instead
    return error('This user has related records (requests, approvals…) and cannot be deleted. Deactivate the account instead.', 409)
  }
  return json({ success: true })
}
