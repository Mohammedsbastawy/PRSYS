import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, error, unauthorized, forbidden, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

// GET /api/departments — list with manager & headcount
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()

  const [deps, counts] = await Promise.all([
    prisma.dEP.findMany({
      select: {
        DEPID: true, Name: true, Code: true, CreatedAt: true,
        Manager: { select: { UserID: true, Name: true, Email: true } },
        _count: { select: { OwnedTemplates: true, FormPerms: true } },
      },
      orderBy: { Name: 'asc' },
    }),
    prisma.users.groupBy({
      by: ['DEPID'],
      where: { IsActive: true, DEPID: { not: null } },
      _count: { _all: true },
    }),
  ])
  const countMap = new Map(counts.map((c) => [c.DEPID, c._count._all]))
  return json(
    deps.map((d) => ({
      ...d,
      memberCount: countMap.get(d.DEPID) ?? 0,
      wfUsageCount: d._count.OwnedTemplates + d._count.FormPerms,
    }))
  )
}

const depSchema = z.object({
  name: z.string().min(1, 'Department name is required'),
  code: z.string().min(1, 'Department code is required'),
  managerId: z.string().optional().nullable(),
})

// POST /api/departments (DEP_MANAGE)
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'DEP_MANAGE')) return forbidden()

  const { data, error: err } = await parseBody(req, depSchema)
  if (err) return error(err!)

  const code = data!.code.trim().toUpperCase()
  const clash = await prisma.dEP.findUnique({ where: { Code: code } })
  if (clash) return error('A department with this code already exists', 409)

  if (data!.managerId) {
    const mgr = await prisma.users.findUnique({ where: { UserID: data!.managerId } })
    if (!mgr) return error('Selected manager does not exist', 400)
    const alreadyLeads = await prisma.dEP.findFirst({ where: { ManagerID: data!.managerId } })
    if (alreadyLeads) return error(`This user already manages "${alreadyLeads.Name}"`, 409)
  }

  const dep = await prisma.dEP.create({
    data: { Name: data!.name.trim(), Code: code, ManagerID: data!.managerId || null },
    select: { DEPID: true, Name: true, Code: true },
  })
  return json(dep, 201)
}
