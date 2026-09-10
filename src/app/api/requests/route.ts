import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

const fieldValueSchema = z.object({
  fieldId: z.string().optional().nullable(),
  value: z.string(),
})
const itemSchema = z.object({
  formFieldId: z.string().optional().nullable(),
  requestedItemName: z.string(),
  requestedItemDetails: z.string().optional().nullable(),
  requestedUom: z.string().optional().nullable(),
  requestedQuantity: z.number(),
  itemCatalogCacheId: z.string().optional().nullable(),
  oracleItemId: z.string().optional().nullable(),
  itemCode: z.string().optional().nullable(),
  itemName: z.string().optional().nullable(),
  uom: z.string().optional().nullable(),
  organizationCode: z.string().optional().nullable(),
  estimatedPrice: z.number().optional().nullable(),
})

const createSchema = z.object({
  formTemplateId: z.string().min(1),
  title: z.string().max(200).optional().nullable(),
  priority: z.string().default('MEDIUM'),
  fieldValues: z.array(fieldValueSchema).default([]),
  items: z.array(itemSchema).default([]),
})

// GET /api/requests — list (filtered by permission)
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx) return forbidden()

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const viewAll = hasPermission(ctx, 'REQUEST_VIEW_ALL')

  const where: Record<string, unknown> = {}
  if (!viewAll) {
    where.RequesterID = payload.userId
  }
  if (status) where.Status = status

  const requests = await prisma.requests.findMany({
    where,
    include: {
      FormTemplate: { select: { FormTemplateID: true, Name: true } },
      Requester: { select: { UserID: true, Name: true } },
      Assignee: { select: { UserID: true, Name: true } },
      CurrentStep: { select: { WFStepID: true, StepName: true } },
      _count: { select: { Items: true, Approvals: true, Comments: true } },
    },
    orderBy: { CreatedAt: 'desc' },
    take: 200,
  })
  return json(requests)
}

// POST /api/requests — create draft
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'REQUEST_CREATE')) return forbidden()

  const { data, error: err } = await parseBody(req, createSchema)
  if (err) return json({ error: err }, 400)

  // generate tracking number
  const count = await prisma.requests.count()
  const year = new Date().getFullYear()
  const tracking = `REQ-${year}-${String(count + 1).padStart(5, '0')}`

  // snapshot form template
  const tmpl = await prisma.formTemplates.findUnique({
    where: { FormTemplateID: data!.formTemplateId },
    include: { Fields: true },
  })
  if (!tmpl) return json({ error: 'Form template not found' }, 404)

  const fieldValues = (data!.fieldValues ?? []).filter((fv) => fv.fieldId).map((fv) => ({
    FormFieldID: fv.fieldId!,
    Value: fv.value,
  }))
  const items = (data!.items ?? []).map((it) => ({
    FormFieldID: it.formFieldId || null,
    RequestedItemName: it.requestedItemName,
    RequestedItemDetails: it.requestedItemDetails ?? null,
    RequestedUom: it.requestedUom ?? null,
    RequestedQuantity: it.requestedQuantity,
    ItemCatalogCacheID: it.itemCatalogCacheId ?? null,
    OracleItemID: it.oracleItemId ?? null,
    ItemCode: it.itemCode ?? null,
    ItemName: it.itemName ?? null,
    Uom: it.uom ?? null,
    OrganizationCode: it.organizationCode ?? null,
    EstimatedPrice: it.estimatedPrice ?? null,
  }))

  const title =
    data!.title?.trim() || items[0]?.RequestedItemName || tmpl.Name

  const request = await prisma.requests.create({
    data: {
      TrackingNumber: tracking,
      Title: title,
      FormTemplateID: data!.formTemplateId,
      RequesterID: payload.userId,
      Status: 'DRAFT',
      Priority: data!.priority,
      FormSnapshot: JSON.stringify(tmpl),
      ...(fieldValues.length ? { FieldValues: { create: fieldValues } } : {}),
      Items: { create: items },
    },
    include: { FieldValues: true, Items: true },
  })

  // audit
  await prisma.requestAuditLog.create({
    data: { RequestID: request.RequestID, ToStatus: 'DRAFT', Action: 'CREATE', ChangedByUserID: payload.userId },
  })

  return json(request, 201)
}
