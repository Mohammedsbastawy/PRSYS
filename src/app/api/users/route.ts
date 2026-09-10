import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest, verifyToken } from '@/lib/auth'
import { json, error, unauthorized, forbidden, notFound, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

// GET /api/users — list users (SUPER_ADMIN / USER_VIEW)
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'USER_VIEW')) return forbidden()

  const users = await prisma.users.findMany({
    select: {
      UserID: true,
      Name: true,
      Email: true,
      AccountType: true,
      IsActive: true,
      CreatedAt: true,
      Role: { select: { RoleID: true, Code: true, Name: true } },
      ManagedDEP: { select: { DEPID: true, Name: true } },
      Manager: { select: { UserID: true, Name: true } },
    },
    orderBy: { Name: 'asc' },
  })
  return json(users)
}

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  roleId: z.string().min(1),
  depId: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  accountType: z.string().default('LOCAL'),
})

// POST /api/users — create user (SUPER_ADMIN / USER_CREATE)
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'USER_CREATE')) return forbidden()

  const { data, error: err } = await parseBody(req, createSchema)
  if (err) return error(err)

  const exists = await prisma.users.findUnique({ where: { Email: data!.email } })
  if (exists) return error('Email already exists', 409)

  const bcrypt = (await import('bcryptjs')).default
  const hash = await bcrypt.hash(data!.password, 10)

  const user = await prisma.users.create({
    data: {
      Name: data!.name,
      Email: data!.email,
      PasswordHash: hash,
      AccountType: data!.accountType,
      RoleID: data!.roleId,
      DEPID: data!.depId ?? null,
      DirectManagerID: data!.managerId ?? null,
      IsActive: true,
    },
    select: { UserID: true, Name: true, Email: true, RoleID: true, DEPID: true },
  })
  return json(user, 201)
}
