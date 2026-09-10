import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'

// GET /api/search?q=... — global request search for the top navbar
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx) return forbidden()

  const viewAll = hasPermission(ctx, 'REQUEST_VIEW_ALL')
  const viewOwn =
    hasPermission(ctx, 'REQUEST_VIEW_OWN') || hasPermission(ctx, 'REQUEST_CREATE')
  if (!viewAll && !viewOwn) return json([])

  const q = new URL(req.url).searchParams.get('q')?.trim() || ''
  if (q.length < 2) return json([])

  const hits = await prisma.requests.findMany({
    where: {
      ...(viewAll ? {} : { RequesterID: payload.userId }),
      OR: [{ TrackingNumber: { contains: q } }, { Title: { contains: q } }],
    },
    select: {
      RequestID: true,
      TrackingNumber: true,
      Title: true,
      Status: true,
      FormTemplate: { select: { Name: true } },
    },
    orderBy: { UpdatedAt: 'desc' },
    take: 8,
  })
  return json(hits)
}
