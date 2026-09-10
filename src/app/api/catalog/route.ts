import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'

// GET /api/catalog?q=search — search item catalog cache
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'CATALOG_VIEW')) return json([])

  const url = new URL(req.url)
  const q = url.searchParams.get('q') || ''
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100)

  const items = await prisma.itemCatalogCache.findMany({
    where: {
      OR: [
        { ItemName: { contains: q } },
        { ItemCode: { contains: q } },
        { OracleItemID: { contains: q } },
      ],
    },
    take: limit,
    orderBy: { ItemName: 'asc' },
  })
  return json(items)
}

// POST /api/catalog — manually add item (sync stub)
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'CATALOG_SYNC')) return json({ error: 'Forbidden' }, 403)
  return json({ message: 'Oracle sync not configured — manual entry only' }, 501)
}
