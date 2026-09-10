import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'

// GET /api/dashboard — stats
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx) return forbidden()

  const viewAll = hasPermission(ctx, 'REQUEST_VIEW_ALL')
  const where = viewAll ? {} : { RequesterID: payload.userId }

  const [total, draft, pending, approved, poRegistered, fulfilled, rejected, myPending] = await Promise.all([
    prisma.requests.count({ where }),
    prisma.requests.count({ where: { ...where, Status: 'DRAFT' } }),
    prisma.requests.count({ where: { ...where, Status: 'PENDING_APPROVAL' } }),
    prisma.requests.count({ where: { ...where, Status: 'APPROVED' } }),
    prisma.requests.count({ where: { ...where, Status: 'PO_REGISTERED' } }),
    prisma.requests.count({ where: { ...where, Status: 'FULFILLED' } }),
    prisma.requests.count({ where: { ...where, Status: 'REJECTED' } }),
    prisma.requests.count({ where: { Status: 'PENDING_APPROVAL', AssigneeID: payload.userId } }),
  ])

  return json({
    total,
    byStatus: { draft, pending, approved, poRegistered, fulfilled, rejected },
    myPendingApprovals: myPending,
  })
}
