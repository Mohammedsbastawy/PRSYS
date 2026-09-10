import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

// GET /api/form-templates
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const templates = await prisma.formTemplates.findMany({
    include: {
      Category: { select: { FormCategoryID: true, Name: true } },
      Workflow: { select: { WFDefinitionID: true, Name: true } },
      Fields: { orderBy: { SortOrder: 'asc' } },
    },
    orderBy: { CreatedAt: 'desc' },
  })
  return json(templates)
}

const fieldSchema = z.object({
  label: z.string().min(1),
  fieldKey: z.string().min(1),
  fieldType: z.string().min(1),
  isRequired: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  config: z.string().optional().nullable(),
})

const tmplSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  formCategoryId: z.string().optional().nullable(),
  wfDefinitionId: z.string().optional().nullable(),
  status: z.string().default('DRAFT'),
  fields: z.array(fieldSchema).default([]),
})

// POST /api/form-templates
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'FORM_TEMPLATE_MANAGE')) return forbidden()

  const { data, error: err } = await parseBody(req, tmplSchema)
  if (err) return json({ error: err }, 400)

  const tmpl = await prisma.formTemplates.create({
    data: {
      Name: data!.name,
      Description: data!.description ?? null,
      FormCategoryID: data!.formCategoryId ?? null,
      WFDefinitionID: data!.wfDefinitionId ?? null,
      Status: data!.status,
      Fields: {
        create: (data!.fields ?? []).map((f) => ({
          Label: f.label,
          FieldKey: f.fieldKey,
          FieldType: f.fieldType,
          IsRequired: f.isRequired,
          SortOrder: f.sortOrder,
          Config: f.config ?? null,
        })),
      },
    },
    include: { Fields: true },
  })
  return json(tmpl, 201)
}
