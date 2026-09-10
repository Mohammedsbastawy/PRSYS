import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

// GET /api/departments
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const deps = await prisma.dEP.findMany({
    select: { DEPID: true, Name: true, Code: true, Manager: { select: { UserID: true, Name: true } } },
    orderBy: { Name: 'asc' },
  })
  return json(deps)
}

const depSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  managerId: z.string().optional().nullable(),
})

// POST /api/departments
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'DEP_MANAGE')) return forbidden()

  const { data, error: err } = await parseBody(req, depSchema)
  if (err) return json({ error: err }, 400)

  const dep = await prisma.dEP.create({
    data: {
      Name: data!.name,
      Code: data!.code,
      ManagerID: data!.managerId ?? null,
    },
    select: { DEPID: true, Name: true, Code: true },
  })
  return json(dep, 201)
}
