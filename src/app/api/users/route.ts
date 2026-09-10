import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, error, unauthorized, forbidden, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

// GET /api/users — list users with search, filters & pagination (USER_VIEW)
// Query: q, roleId, depId ('none' = no department), status=active|inactive, accountType, page, pageSize
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'USER_VIEW')) return forbidden()

  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') || '').trim()
  const roleId = sp.get('roleId') || ''
  const depId = sp.get('depId') || ''
  const status = sp.get('status') || ''
  const accountType = sp.get('accountType') || ''
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
  const pageSize = Math.min(500, Math.max(1, parseInt(sp.get('pageSize') || '10', 10) || 10))

  const where: Record<string, unknown> = {}
  if (q) where.OR = [{ Name: { contains: q } }, { Email: { contains: q } }]
  if (roleId) where.RoleID = roleId
  if (depId === 'none') where.DEPID = null
  else if (depId) where.DEPID = depId
  if (status === 'active') where.IsActive = true
  if (status === 'inactive') where.IsActive = false
  if (accountType) where.AccountType = accountType

  const [total, users] = await Promise.all([
    prisma.users.count({ where }),
    prisma.users.findMany({
      where,
      select: {
        UserID: true,
        Name: true,
        Email: true,
        AccountType: true,
        IsActive: true,
        CreatedAt: true,
        DEPID: true,
        RoleID: true,
        DirectManagerID: true,
        Role: { select: { RoleID: true, Code: true, Name: true } },
        ManagedDEP: { select: { DEPID: true, Name: true } },
        Manager: { select: { UserID: true, Name: true } },
        GroupMembers: { select: { GroupRef: { select: { GroupID: true, Name: true } } } },
      },
      orderBy: { Name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  // Manual DEP lookup — Users.DEPID intentionally has no FK relation in the schema
  const deps = await prisma.dEP.findMany({ select: { DEPID: true, Name: true, Code: true } })
  const depMap = new Map(deps.map((d) => [d.DEPID, d]))

  const items = users.map(({ GroupMembers, ...u }) => ({
    ...u,
    Department: u.DEPID ? (depMap.get(u.DEPID) ?? null) : null,
    Groups: GroupMembers.map((m) => m.GroupRef),
  }))

  return json({ items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) })
}

const createSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  roleId: z.string().min(1, 'Role is required'),
  depId: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  accountType: z.string().default('LOCAL'),
})

// POST /api/users — create user (USER_CREATE)
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'USER_CREATE')) return forbidden()

  const { data, error: err } = await parseBody(req, createSchema)
  if (err) return error(err!)

  const email = data!.email.trim().toLowerCase()
  const exists = await prisma.users.findUnique({ where: { Email: email } })
  if (exists) return error('A user with this email already exists', 409)

  const role = await prisma.roles.findUnique({ where: { RoleID: data!.roleId } })
  if (!role) return error('Selected role does not exist', 400)

  if (data!.depId) {
    const dep = await prisma.dEP.findUnique({ where: { DEPID: data!.depId } })
    if (!dep) return error('Selected department does not exist', 400)
  }
  if (data!.managerId) {
    if (data!.managerId === data!.depId) return error('Invalid manager', 400)
    const mgr = await prisma.users.findUnique({ where: { UserID: data!.managerId } })
    if (!mgr) return error('Selected manager does not exist', 400)
  }

  const bcrypt = (await import('bcryptjs')).default
  const hash = await bcrypt.hash(data!.password, 10)

  const user = await prisma.users.create({
    data: {
      Name: data!.name.trim(),
      Email: email,
      PasswordHash: hash,
      AccountType: data!.accountType,
      RoleID: data!.roleId,
      DEPID: data!.depId || null,
      DirectManagerID: data!.managerId || null,
      IsActive: true,
    },
    select: { UserID: true, Name: true, Email: true, RoleID: true, DEPID: true },
  })
  return json(user, 201)
}
