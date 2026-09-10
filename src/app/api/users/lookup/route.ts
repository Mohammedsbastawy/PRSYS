import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'

// GET /api/users/lookup — minimal active-user list for assignment pickers
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'REQUEST_ASSIGN')) return forbidden()

  const users = await prisma.users.findMany({
    where: { IsActive: true },
    select: {
      UserID: true,
      Name: true,
      Email: true,
      Role: { select: { Name: true } },
    },
    orderBy: { Name: 'asc' },
  })
  return json(users)
}
