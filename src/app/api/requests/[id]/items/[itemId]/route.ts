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
//
// Stock split rules (the system enforces them, it does not guess):
//   • Issue from stock can never exceed the on-hand qty (max = on-hand)
//   • Issue from stock can never exceed the requested qty
//   • Issuing anything requires a recorded on-hand qty (the verifier
//     confirms stock exists before taking from it)
//   • To purchase is DERIVED data: requested qty − issued from stock
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

  // ---- stock split validation + auto to-purchase ----
  const qty = Number(item.RequestedQuantity)
  const storedOnHand = item.OnHandQuantity === null ? null : Number(item.OnHandQuantity)
  const newOnHand = data!.onHandQuantity !== undefined ? data!.onHandQuantity : storedOnHand
  const issuedProvided = data!.issuedFromStockQuantity !== undefined
  const newIssued = issuedProvided
    ? Number(data!.issuedFromStockQuantity ?? 0)
    : Number(item.IssuedFromStockQuantity ?? 0)

  if (issuedProvided) {
    if (newIssued > 0 && newOnHand === null) {
      return json(
        { error: 'Record the on-hand quantity before issuing from stock' },
        400
      )
    }
    // the on-hand check first — it is the tighter, more actionable cap
    if (newOnHand !== null && newIssued > newOnHand) {
      return json(
        { error: `Issue from stock can't exceed the on-hand quantity (${newOnHand})` },
        400
      )
    }
    if (newIssued > qty) {
      return json(
        { error: `Issue from stock can't exceed the requested quantity (${qty})` },
        400
      )
    }
    // to-purchase is automatic: whatever the stock doesn't cover gets purchased
    update.ToPurchaseQuantity = Math.max(0, qty - newIssued)
  } else if (data!.toPurchaseQuantity !== undefined) {
    // caller adjusted only the purchase qty (rare) — accept as-is
    update.ToPurchaseQuantity = data!.toPurchaseQuantity
  }

  if (data!.onHandQuantity !== undefined) update.OnHandQuantity = data!.onHandQuantity
  if (issuedProvided) {
    update.IssuedFromStockQuantity = newIssued
  }
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
