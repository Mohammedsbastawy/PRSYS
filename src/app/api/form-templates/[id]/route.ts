import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, notFound, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { canUserUseTemplate } from '@/lib/form-visibility'
import { FIELD_TYPE_VALUES } from '@/lib/field-config'
import { buildIdHead, validateIdFormat } from '@/lib/request-ids'
import { z } from 'zod'

interface Params { params: { id: string } }

// GET /api/form-templates/[id] — with ?context=fill for the request fill page
export async function GET(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()

  const tmpl = await prisma.formTemplates.findUnique({
    where: { FormTemplateID: params.id },
    include: {
      Category: true,
      Workflow: { include: { Steps: { orderBy: { StepOrder: 'asc' } } } },
      OwnerDEP: { select: { DEPID: true, Name: true } },
      OwnerGroup: { select: { GroupID: true, Name: true } },
      FormPerms: {
        include: {
          DEP: { select: { Name: true } },
          Group: { select: { Name: true } },
          User: { select: { Name: true } },
        },
        orderBy: { CreatedAt: 'asc' },
      },
      Fields: { orderBy: { SortOrder: 'asc' } },
    },
  })
  if (!tmpl) return notFound('Template not found')

  // Fill context: only usable (ACTIVE + visible) forms for requesters.
  // Admins / form managers bypass the check (they need DRAFT previews too).
  const url = new URL(req.url)
  if (url.searchParams.get('context') === 'fill') {
    const ctx = await getUserContext(payload.userId)
    const bypass =
      ctx && (ctx.roleCode === 'SUPER_ADMIN' || hasPermission(ctx, 'FORM_TEMPLATE_MANAGE'))
    if (!bypass) {
      if (tmpl.Status !== 'ACTIVE') return notFound('Form not available')
      const canUse = await canUserUseTemplate(payload.userId, params.id)
      if (!canUse) return json({ error: 'You do not have access to this form' }, 403)
    }
  }

  return json(tmpl)
}

const patchSchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE']).optional(),
  wfDefinitionId: z.string().nullable().optional(),
})

// PATCH /api/form-templates/[id] — publish/unpublish + workflow assignment
export async function PATCH(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'FORM_TEMPLATE_MANAGE')) return forbidden()

  const { data, error: err } = await parseBody(req, patchSchema)
  if (err) return json({ error: err }, 400)

  const existing = await prisma.formTemplates.findUnique({
    where: { FormTemplateID: params.id },
    select: { FormTemplateID: true },
  })
  if (!existing) return notFound('Template not found')
  if (data!.status === undefined && data!.wfDefinitionId === undefined) {
    return json({ error: 'Nothing to update' }, 400)
  }
  if (data!.wfDefinitionId) {
    const wf = await prisma.wFDefinitions.findUnique({
      where: { WFDefinitionID: data!.wfDefinitionId },
      select: { WFDefinitionID: true },
    })
    if (!wf) return json({ error: 'Workflow not found' }, 400)
  }

  const tmpl = await prisma.formTemplates.update({
    where: { FormTemplateID: params.id },
    data: {
      ...(data!.status !== undefined ? { Status: data!.status } : {}),
      ...(data!.wfDefinitionId !== undefined ? { WFDefinitionID: data!.wfDefinitionId } : {}),
    },
    select: { FormTemplateID: true, Status: true, WFDefinitionID: true },
  })
  return json(tmpl)
}

const fieldSchema = z.object({
  id: z.string().optional(), // FormFieldID for existing fields; absent = new field
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
  visibility: z.array(visibilitySchema).default([]),
  idPrefix: z.string().max(10).optional().nullable(),
  idSeparator: z.string().max(3).optional().nullable(),
  idPadding: z.number().int().min(0).max(10).default(0),
  idIncludeYear: z.boolean().default(false),
  fields: z.array(fieldSchema).default([]),
})

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

// PUT /api/form-templates/[id] — full update (settings + fields merge + owner + visibility + ID format)
export async function PUT(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'FORM_TEMPLATE_MANAGE')) return forbidden()

  const { data, error: err } = await parseBody(req, tmplSchema)
  if (err) return json({ error: err }, 400)
  const fields = data!.fields ?? []

  const seen = new Set<string>()
  for (const f of fields) {
    const k = f.fieldKey.toLowerCase()
    if (seen.has(k)) return json({ error: `Duplicate field key: ${f.fieldKey}` }, 400)
    seen.add(k)
    if (f.config) {
      try {
        JSON.parse(f.config)
      } catch {
        return json({ error: `Field "${f.label}": options must be valid JSON` }, 400)
      }
    }
  }

  if (data!.ownerDepId && data!.ownerGroupId) {
    return json({ error: 'Choose either a department owner or a group owner, not both' }, 400)
  }
  if (data!.formCategoryId) {
    const c = await prisma.formCategories.findUnique({
      where: { FormCategoryID: data!.formCategoryId },
      select: { FormCategoryID: true },
    })
    if (!c) return json({ error: 'Category not found' }, 400)
  }
  if (data!.wfDefinitionId) {
    const w = await prisma.wFDefinitions.findUnique({
      where: { WFDefinitionID: data!.wfDefinitionId },
      select: { WFDefinitionID: true },
    })
    if (!w) return json({ error: 'Workflow not found' }, 400)
  }
  if (data!.ownerDepId) {
    const d = await prisma.dEP.findUnique({
      where: { DEPID: data!.ownerDepId },
      select: { DEPID: true },
    })
    if (!d) return json({ error: 'Owner department not found' }, 400)
  }
  if (data!.ownerGroupId) {
    const g = await prisma.groups.findUnique({
      where: { GroupID: data!.ownerGroupId },
      select: { GroupID: true },
    })
    if (!g) return json({ error: 'Owner group not found' }, 400)
  }
  const vis = await normalizeVisibility(data!.visibility ?? [])
  if (vis.error) return json({ error: vis.error }, 400)

  const existing = await prisma.formTemplates.findUnique({
    where: { FormTemplateID: params.id },
    include: { Fields: { select: { FormFieldID: true } } },
  })
  if (!existing) return notFound('Template not found')

  // ---- request ID format: normalize, validate, collision-check ----
  const prefixRaw = (data!.idPrefix ?? '').trim()
  const prefix = prefixRaw === '' ? null : prefixRaw.toUpperCase()
  const separator = data!.idSeparator ?? ''
  const padding = data!.idPadding ?? 0
  const includeYear = data!.idIncludeYear ?? false
  const idErr = validateIdFormat(prefix, separator, padding, includeYear)
  if (idErr) return json({ error: idErr }, 400)
  const yearNow = new Date().getFullYear()
  const oldHead = buildIdHead(
    {
      prefix: existing.IdPrefix,
      separator: existing.IdSeparator ?? '',
      padding: existing.IdPadding,
      includeYear: existing.IdIncludeYear,
    },
    yearNow
  )
  const newHead = buildIdHead({ prefix, separator, padding, includeYear }, yearNow)
  const headChanged = oldHead !== newHead
  if (prefix) {
    const taken = await prisma.formTemplates.findMany({
      where: { FormTemplateID: { not: params.id }, IdPrefix: { not: null } },
      select: { Name: true, IdPrefix: true },
    })
    const clash = taken.find(
      (o: { Name: string; IdPrefix: string | null }) =>
        o.IdPrefix !== null && o.IdPrefix.toLowerCase() === prefix.toLowerCase()
    )
    if (clash) return json({ error: `ID prefix "${prefix}" is already used by "${clash.Name}"` }, 400)
    // only re-check overlap when the generated head actually changed, so the
    // template's own previously issued IDs don't block unrelated saves
    if (headChanged) {
      const conflict = await prisma.requests.findFirst({
        where: { TrackingNumber: { startsWith: newHead! } },
        select: { TrackingNumber: true },
      })
      if (conflict) {
        return json(
          { error: `ID prefix "${prefix}" conflicts with existing request ID "${conflict.TrackingNumber}" — pick a different abbreviation` },
          400
        )
      }
    }
  }

  const existingIds = new Set<string>(
    existing.Fields.map((f: { FormFieldID: string }) => f.FormFieldID)
  )
  const incomingIds = new Set<string>()
  for (const f of fields) {
    if (f.id) {
      if (!existingIds.has(f.id)) return json({ error: 'Unknown field id' }, 400)
      incomingIds.add(f.id)
    }
  }
  const toDelete = Array.from(existingIds).filter((id) => !incomingIds.has(id))

  try {
    await prisma.$transaction(async (tx) => {
      if (toDelete.length > 0) {
        await tx.formFields.deleteMany({ where: { FormFieldID: { in: toDelete } } })
      }
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i]
        const row = {
          Label: f.label,
          FieldKey: f.fieldKey,
          FieldType: f.fieldType,
          IsRequired: f.isRequired,
          SortOrder: i,
          Config: f.config ?? null,
        }
        if (f.id) {
          await tx.formFields.update({ where: { FormFieldID: f.id }, data: row })
        } else {
          await tx.formFields.create({ data: { ...row, FormTemplateID: params.id } })
        }
      }
      // replace visibility grants wholesale
      await tx.formPermissions.deleteMany({
        where: { FormTemplateID: params.id, PermissionType: 'VIEW' },
      })
      if (vis.rows.length > 0) {
        await tx.formPermissions.createMany({
          data: vis.rows.map((v) => ({
            FormTemplateID: params.id,
            PermissionType: 'VIEW',
            DEPID: v.depId,
            GroupID: v.groupId,
            UserID: v.userId,
          })),
        })
      }
      await tx.formTemplates.update({
        where: { FormTemplateID: params.id },
        data: {
          Name: data!.name,
          Description: data!.description ?? null,
          FormCategoryID: data!.formCategoryId ?? null,
          WFDefinitionID: data!.wfDefinitionId ?? null,
          Status: data!.status,
          OwnerDEPID: data!.ownerDepId ?? null,
          OwnerGroupID: data!.ownerGroupId ?? null,
          IdPrefix: prefix,
          IdSeparator: separator === '' ? null : separator,
          IdPadding: padding,
          IdIncludeYear: includeYear,
          ...(headChanged ? { IdNextSeq: 1 } : {}),
          Version: { increment: 1 },
        },
      })
    })
  } catch (e) {
    // unique-prefix race between concurrent saves
    if (isPrismaUniqueError(e)) {
      return json({ error: `ID prefix "${prefix}" is already in use — pick a different abbreviation` }, 400)
    }
    throw e
  }

  const tmpl = await prisma.formTemplates.findUnique({
    where: { FormTemplateID: params.id },
    include: {
      Category: { select: { FormCategoryID: true, Name: true } },
      Workflow: { select: { WFDefinitionID: true, Name: true } },
      OwnerDEP: { select: { DEPID: true, Name: true } },
      OwnerGroup: { select: { GroupID: true, Name: true } },
      Fields: { orderBy: { SortOrder: 'asc' } },
    },
  })
  return json(tmpl)
}

// DELETE /api/form-templates/[id] — blocked while requests use the template
export async function DELETE(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'FORM_TEMPLATE_MANAGE')) return forbidden()

  const tmpl = await prisma.formTemplates.findUnique({
    where: { FormTemplateID: params.id },
    select: {
      FormTemplateID: true,
      Name: true,
      _count: { select: { Requests: true } },
    },
  })
  if (!tmpl) return notFound('Template not found')
  if (tmpl._count.Requests > 0) {
    return json(
      { error: `Cannot delete "${tmpl.Name}": ${tmpl._count.Requests} request(s) use this template` },
      409
    )
  }
  await prisma.formTemplates.delete({ where: { FormTemplateID: params.id } })
  return json({ ok: true })
}
