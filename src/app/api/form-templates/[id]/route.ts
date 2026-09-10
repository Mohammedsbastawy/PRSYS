import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, notFound, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

interface Params { params: { id: string } }

// GET /api/form-templates/[id]
export async function GET(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()

  const tmpl = await prisma.formTemplates.findUnique({
    where: { FormTemplateID: params.id },
    include: {
      Category: true,
      Workflow: { include: { Steps: { orderBy: { StepOrder: 'asc' } } } },
      Fields: { orderBy: { SortOrder: 'asc' } },
    },
  })
  if (!tmpl) return notFound('Template not found')
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
  fieldType: z.enum(['text', 'textarea', 'number', 'date', 'select', 'checkbox']),
  isRequired: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  config: z.string().optional().nullable(),
})

const tmplSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(500).optional().nullable(),
  formCategoryId: z.string().optional().nullable(),
  wfDefinitionId: z.string().optional().nullable(),
  status: z.enum(['DRAFT', 'ACTIVE']).default('DRAFT'),
  fields: z.array(fieldSchema).default([]),
})

// PUT /api/form-templates/[id] — full update (settings + fields merge)
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

  const existing = await prisma.formTemplates.findUnique({
    where: { FormTemplateID: params.id },
    include: { Fields: { select: { FormFieldID: true } } },
  })
  if (!existing) return notFound('Template not found')

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
    await tx.formTemplates.update({
      where: { FormTemplateID: params.id },
      data: {
        Name: data!.name,
        Description: data!.description ?? null,
        FormCategoryID: data!.formCategoryId ?? null,
        WFDefinitionID: data!.wfDefinitionId ?? null,
        Status: data!.status,
        Version: { increment: 1 },
      },
    })
  })

  const tmpl = await prisma.formTemplates.findUnique({
    where: { FormTemplateID: params.id },
    include: {
      Category: { select: { FormCategoryID: true, Name: true } },
      Workflow: { select: { WFDefinitionID: true, Name: true } },
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
