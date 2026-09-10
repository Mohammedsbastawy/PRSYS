import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, notFound, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

interface Params { params: { id: string; itemId: string } }

const verifySchema = z.object({
  itemCatalogCacheId: z.string().optional().nullable(),
  onHandQuantity: z.number().min(0).optional().nullable(),
  issuedFromStockQuantity: z.number().min(0).optional().nullable(),
  toPurchaseQuantity: z.number().min(0).optional().nullable(),
  estimatedPrice: z.number().min(0).optional().nullable(),
  stockDecisionNotes: z.string().max(500).optional().nullable(),
})

// PATCH /api/requests/[id]/items/[itemId] — procurement verification (link catalog + stock split)
export async function PATCH(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'REQUEST_VERIFY_ITEMS')) return forbidden()

  const item = await prisma.requestItems.findFirst({
    where: { RequestItemID: params.itemId, RequestID: params.id },
  })
  if (!item) return notFound('Item not found')

  const { data, error: err } = await parseBody(req, verifySchema)
  if (err) return json({ error: err }, 400)

  const update: Record<string, unknown> = {
    ItemVerifiedByUserID: payload.userId,
    ItemVerifiedAt: new Date(),
  }
  if (data!.onHandQuantity !== undefined) update.OnHandQuantity = data!.onHandQuantity
  if (data!.issuedFromStockQuantity !== undefined) {
    update.IssuedFromStockQuantity = data!.issuedFromStockQuantity
  }
  if (data!.toPurchaseQuantity !== undefined) update.ToPurchaseQuantity = data!.toPurchaseQuantity
  if (data!.estimatedPrice !== undefined) update.EstimatedPrice = data!.estimatedPrice
  if (data!.stockDecisionNotes !== undefined) update.StockDecisionNotes = data!.stockDecisionNotes

  if (data!.itemCatalogCacheId) {
    const cat = await prisma.itemCatalogCache.findUnique({
      where: { ItemCatalogCacheID: data!.itemCatalogCacheId },
    })
    if (!cat) return json({ error: 'Catalog item not found' }, 404)
    update.ItemCatalogCacheID = cat.ItemCatalogCacheID
    update.OracleItemID = cat.OracleItemID
    update.ItemCode = cat.ItemCode
    update.ItemName = cat.ItemName
    update.Uom = cat.Uom
    update.OrganizationCode = cat.OrganizationCode
  }

  const saved = await prisma.requestItems.update({
    where: { RequestItemID: params.itemId },
    data: update,
    include: { Verifier: { select: { UserID: true, Name: true } } },
  })

  await prisma.requestAuditLog.create({
    data: {
      RequestID: params.id,
      Action: 'ITEM_VERIFIED',
      Note: item.RequestedItemName.slice(0, 200),
      ChangedByUserID: payload.userId,
    },
  })

  return json(saved)
}
