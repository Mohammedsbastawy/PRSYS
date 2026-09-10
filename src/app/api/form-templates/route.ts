import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { templateVisibilityWhere, viewerScope, visibilityBypass } from '@/lib/form-visibility'
import { FIELD_TYPE_VALUES } from '@/lib/field-config'
import { buildIdHead, validateIdFormat } from '@/lib/request-ids'
import { z } from 'zod'

// GET /api/form-templates — managers/admin see everything; everyone else
// only the forms they were granted (public forms, explicit VIEW rows or ownership)
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx) return forbidden()
  const bypass = visibilityBypass(ctx) || hasPermission(ctx, 'FORM_TEMPLATE_MANAGE')
  const where = bypass ? {} : templateVisibilityWhere(await viewerScope(payload.userId))
  const templates = await prisma.formTemplates.findMany({
    where,
    include: {
      Category: { select: { FormCategoryID: true, Name: true } },
      Workflow: { select: { WFDefinitionID: true, Name: true } },
      OwnerDEP: { select: { DEPID: true, Name: true } },
      OwnerGroup: { select: { GroupID: true, Name: true } },
      Fields: { orderBy: { SortOrder: 'asc' } },
      _count: { select: { Requests: true } },
    },
    orderBy: { CreatedAt: 'desc' },
  })
  return json(templates)
}

const fieldSchema = z.object({
  id: z.string().optional(), // present on update, ignored on create
  label: z.string().min(1).max(100),
  fieldKey: z.string().min(1).max(60).regex(/^[A-Za-z0-9_]+$/, 'Use letters, numbers and underscore only'),
  fieldType: z.enum(FIELD_TYPE_VALUES),
  isRequired: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  config: z.string().optional().nullable(),
})

const visibilitySchema = z.object({
  depId: z.string().optional().nullable(),
  groupId: z.string().optional().nullable(),
  userId: z.string().optional().nullable(),
})

const tmplSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(500).optional().nullable(),
  formCategoryId: z.string().optional().nullable(),
  wfDefinitionId: z.string().optional().nullable(),
  status: z.enum(['DRAFT', 'ACTIVE']).default('DRAFT'),
  ownerDepId: z.string().optional().nullable(),
  ownerGroupId: z.string().optional().nullable(),
  slaPolicyId: z.string().optional().nullable(),
  requestFormConfig: z.record(z.string(), z.unknown()).optional().nullable(),
  visibility: z.array(visibilitySchema).default([]),
  idPrefix: z.string().max(10).optional().nullable(),
  idSeparator: z.string().max(3).optional().nullable(),
  idPadding: z.number().int().min(0).max(10).default(0),
  idIncludeYear: z.boolean().default(false),
  fields: z.array(fieldSchema).default([]),
})

function findDuplicateKeys(fields: { fieldKey: string }[]): string | null {
  const seen = new Set<string>()
  for (const f of fields) {
    const k = f.fieldKey.toLowerCase()
    if (seen.has(k)) return f.fieldKey
    seen.add(k)
  }
  return null
}

async function validateRefs(
  formCategoryId: string | null | undefined,
  wfDefinitionId: string | null | undefined,
  ownerDepId: string | null | undefined,
  ownerGroupId: string | null | undefined
): Promise<string | null> {
  if (formCategoryId) {
    const c = await prisma.formCategories.findUnique({
      where: { FormCategoryID: formCategoryId },
      select: { FormCategoryID: true },
    })
    if (!c) return 'Category not found'
  }
  if (wfDefinitionId) {
    const w = await prisma.wFDefinitions.findUnique({
      where: { WFDefinitionID: wfDefinitionId },
      select: { WFDefinitionID: true },
    })
    if (!w) return 'Workflow not found'
  }
  if (ownerDepId) {
    const d = await prisma.dEP.findUnique({
      where: { DEPID: ownerDepId },
      select: { DEPID: true },
    })
    if (!d) return 'Owner department not found'
  }
  if (ownerGroupId) {
    const g = await prisma.groups.findUnique({
      where: { GroupID: ownerGroupId },
      select: { GroupID: true },
    })
    if (!g) return 'Owner group not found'
  }
  return null
}

function invalidConfig(fields: { label: string; config?: string | null }[]): string | null {
  for (const f of fields) {
    if (f.config) {
      try {
        JSON.parse(f.config)
      } catch {
        return `Field "${f.label}": options must be valid JSON`
      }
    }
  }
  return null
}

interface VisibilityRow {
  depId?: string | null
  groupId?: string | null
  userId?: string | null
}

/** Validate visibility rows (refs exist) and remove duplicates. */
async function normalizeVisibility(
  rows: VisibilityRow[]
): Promise<{ rows: VisibilityRow[]; error: string | null }> {
  const seen = new Set<string>()
  const out: VisibilityRow[] = []
  for (const r of rows) {
    const depId = r.depId || null
    const groupId = r.groupId || null
    const userId = r.userId || null
    if (!depId && !groupId && !userId) {
      return { rows: [], error: 'Each visibility row needs a department, group or user' }
    }
    const key = `${depId ?? ''}|${groupId ?? ''}|${userId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    if (depId) {
      const d = await prisma.dEP.findUnique({ where: { DEPID: depId }, select: { DEPID: true } })
      if (!d) return { rows: [], error: 'Visibility department not found' }
    }
    if (groupId) {
      const g = await prisma.groups.findUnique({ where: { GroupID: groupId }, select: { GroupID: true } })
      if (!g) return { rows: [], error: 'Visibility group not found' }
    }
    if (userId) {
      const u = await prisma.users.findUnique({ where: { UserID: userId }, select: { UserID: true } })
      if (!u) return { rows: [], error: 'Visibility user not found' }
    }
    out.push({ depId, groupId, userId })
  }
  return { rows: out, error: null }
}

function isPrismaUniqueError(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === 'P2002'
}

// POST /api/form-templates
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'FORM_TEMPLATE_MANAGE')) return forbidden()

  const { data, error: err } = await parseBody(req, tmplSchema)
  if (err) return json({ error: err }, 400)

  const dup = findDuplicateKeys(data!.fields ?? [])
  if (dup) return json({ error: `Duplicate field key: ${dup}` }, 400)
  if (data!.ownerDepId && data!.ownerGroupId) {
    return json({ error: 'Choose either a department owner or a group owner, not both' }, 400)
  }
  const refErr = await validateRefs(data!.formCategoryId, data!.wfDefinitionId, data!.ownerDepId, data!.ownerGroupId)
  if (refErr) return json({ error: refErr }, 400)
  const cfgErr = invalidConfig(data!.fields ?? [])
  if (cfgErr) return json({ error: cfgErr }, 400)
  const vis = await normalizeVisibility(data!.visibility ?? [])
  if (vis.error) return json({ error: vis.error }, 400)

  // ---- request ID format: normalize, validate, collision-check ----
  const prefixRaw = (data!.idPrefix ?? '').trim()
  const prefix = prefixRaw === '' ? null : prefixRaw.toUpperCase()
  const separator = data!.idSeparator ?? ''
  const padding = data!.idPadding ?? 0
  const includeYear = data!.idIncludeYear ?? false
  const idErr = validateIdFormat(prefix, separator, padding, includeYear)
  if (idErr) return json({ error: idErr }, 400)
  if (prefix) {
    const taken = await prisma.formTemplates.findMany({
      where: { IdPrefix: { not: null } },
      select: { Name: true, IdPrefix: true },
    })
    const clash = taken.find(
      (o: { Name: string; IdPrefix: string | null }) =>
        o.IdPrefix !== null && o.IdPrefix.toLowerCase() === prefix.toLowerCase()
    )
    if (clash) return json({ error: `ID prefix "${prefix}" is already used by "${clash.Name}"` }, 400)
    const head = buildIdHead({ prefix, separator, padding, includeYear }, new Date().getFullYear())!
    const conflict = await prisma.requests.findFirst({
      where: { TrackingNumber: { startsWith: head } },
      select: { TrackingNumber: true },
    })
    if (conflict) {
      return json(
        { error: `ID prefix "${prefix}" conflicts with existing request ID "${conflict.TrackingNumber}" — pick a different abbreviation` },
        400
      )
    }
  }

  let tmpl
  try {
    tmpl = await prisma.formTemplates.create({
      data: {
        Name: data!.name,
        Description: data!.description ?? null,
        FormCategoryID: data!.formCategoryId ?? null,
        WFDefinitionID: data!.wfDefinitionId ?? null,
        Status: data!.status,
        OwnerDEPID: data!.ownerDepId ?? null,
        SLAPolicyID: data!.slaPolicyId ?? null,
        RequestFormConfig: data!.requestFormConfig ? JSON.stringify(data!.requestFormConfig) : null,
        OwnerGroupID: data!.ownerGroupId ?? null,
        IdPrefix: prefix,
        IdSeparator: separator === '' ? null : separator,
        IdPadding: padding,
        IdIncludeYear: includeYear,
        Fields: {
          create: (data!.fields ?? []).map((f, i) => ({
            Label: f.label,
            FieldKey: f.fieldKey,
            FieldType: f.fieldType,
            IsRequired: f.isRequired,
            SortOrder: i,
            Config: f.config ?? null,
          })),
        },
        ...(vis.rows.length > 0
          ? {
              FormPerms: {
                create: vis.rows.map((v) => ({
                  PermissionType: 'VIEW',
                  DEPID: v.depId,
                  GroupID: v.groupId,
                  UserID: v.userId,
                })),
              },
            }
          : {}),
      },
      include: { Fields: true },
    })
  } catch (e) {
    // unique-prefix race between concurrent saves
    if (isPrismaUniqueError(e)) {
      return json({ error: `ID prefix "${prefix}" is already in use — pick a different abbreviation` }, 400)
    }
    throw e
  }
  return json(tmpl, 201)
}
