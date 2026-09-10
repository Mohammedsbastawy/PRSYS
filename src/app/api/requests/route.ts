import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { canUserUseTemplate, requestVisibilityWhere, viewerScope, visibilityBypass } from '@/lib/form-visibility'
import { formatRequestId } from '@/lib/request-ids'
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
  neededByDate: z.string().optional().nullable(),
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
    // self-service scope: own requests + requests of departments the user manages —
    // a department manager keeps the normal UI yet sees their team's tickets.
    const managed = await prisma.dEP.findMany({
      where: { ManagerID: payload.userId },
      select: { DEPID: true },
    })
    const or: Record<string, unknown>[] = [{ RequesterID: payload.userId }]
    for (const d of managed) or.push({ Requester: { DEPID: d.DEPID } })
    where.OR = or
  }
  // form-visibility ACL: restricted forms are invisible except to granted
  // targets / the form owner — a requester always keeps their own requests.
  if (!visibilityBypass(ctx)) {
    where.AND = [...(Array.isArray(where.AND) ? (where.AND as unknown[]) : []), requestVisibilityWhere(await viewerScope(payload.userId))]
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

/** Next free legacy tracking number (REQ-YEAR-SEQ). Bumps past any taken value. */
async function nextLegacyTracking(year: number): Promise<string> {
  const count = await prisma.requests.count({ where: { FormTemplate: { IdPrefix: null } } })
  let seq = (count as number) + 1
  for (let i = 0; i < 50; i++) {
    const candidate = `REQ-${year}-${String(seq).padStart(5, '0')}`
    const exists = await prisma.requests.findUnique({
      where: { TrackingNumber: candidate },
      select: { RequestID: true },
    })
    if (!exists) return candidate
    seq++
  }
  // extreme fallback — timestamp suffix guarantees progress
  return `REQ-${year}-${Date.now().toString(36).toUpperCase()}`
}

function isTrackingConflict(e: unknown): boolean {
  const err = e as { code?: unknown; meta?: unknown } | null
  if (!err || err.code !== 'P2002') return false
  const target = (err.meta as { target?: unknown } | undefined)?.target
  return !Array.isArray(target) || (target as unknown[]).includes('TrackingNumber')
}

// POST /api/requests — create draft
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'REQUEST_CREATE')) return forbidden()

  const { data, error: err } = await parseBody(req, createSchema)
  if (err) return json({ error: err }, 400)

  let neededBy: Date | null = null
  if (data!.neededByDate) {
    neededBy = new Date(data!.neededByDate)
    if (isNaN(neededBy.getTime())) return json({ error: 'Invalid neededByDate' }, 400)
  }

  // snapshot form template
  const tmpl = await prisma.formTemplates.findUnique({
    where: { FormTemplateID: data!.formTemplateId },
    include: { Fields: true },
  })
  if (!tmpl) return json({ error: 'Form template not found' }, 404)

  // visibility: form managers bypass, everyone else must be granted the form
  const canManageForms =
    ctx.roleCode === 'SUPER_ADMIN' || hasPermission(ctx, 'FORM_TEMPLATE_MANAGE')
  if (!canManageForms && !(await canUserUseTemplate(payload.userId, data!.formTemplateId))) {
    return json({ error: 'You do not have access to this form' }, 403)
  }

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

  const year = new Date().getFullYear()
  const idCfg = {
    prefix: (tmpl.IdPrefix as string | null) ?? null,
    separator: (tmpl.IdSeparator as string | null) ?? '',
    padding: (tmpl.IdPadding as number | null) ?? 0,
    includeYear: (tmpl.IdIncludeYear as boolean | null) ?? false,
  }

  const buildData = (tracking: string) => ({
    TrackingNumber: tracking,
    Title: title,
    FormTemplateID: data!.formTemplateId,
    RequesterID: payload.userId,
    Status: 'DRAFT',
    Priority: data!.priority,
    NeededByDate: neededBy,
    FormSnapshot: JSON.stringify(tmpl),
    ...(fieldValues.length ? { FieldValues: { create: fieldValues } } : {}),
    Items: { create: items },
  })

  // Reserve a unique tracking number — atomic per-template sequence for
  // prefixed forms, hardened global numbering otherwise — with P2002 retry
  // so concurrent creates never fail with a duplicate ID.
  let request = null
  for (let attempt = 0; attempt < 5 && !request; attempt++) {
    try {
      if (idCfg.prefix) {
        request = await prisma.$transaction(async (tx) => {
          const t = await tx.formTemplates.update({
            where: { FormTemplateID: data!.formTemplateId },
            data: { IdNextSeq: { increment: 1 } },
            select: { IdNextSeq: true },
          })
          return tx.requests.create({
            data: buildData(formatRequestId(idCfg, year, t.IdNextSeq - 1)),
            include: { FieldValues: true, Items: true },
          })
        })
      } else {
        request = await prisma.requests.create({
          data: buildData(await nextLegacyTracking(year)),
          include: { FieldValues: true, Items: true },
        })
      }
    } catch (e) {
      if (isTrackingConflict(e)) continue
      throw e
    }
  }
  if (!request) return json({ error: 'Could not generate a unique request ID — please retry' }, 500)

  // audit
  await prisma.requestAuditLog.create({
    data: { RequestID: request.RequestID, ToStatus: 'DRAFT', Action: 'CREATE', ChangedByUserID: payload.userId },
  })

  return json(request, 201)
}
