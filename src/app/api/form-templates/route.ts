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
  wfDefinitionId: string | null | undefined
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
  const refErr = await validateRefs(data!.formCategoryId, data!.wfDefinitionId)
  if (refErr) return json({ error: refErr }, 400)
  const cfgErr = invalidConfig(data!.fields ?? [])
  if (cfgErr) return json({ error: cfgErr }, 400)

  const tmpl = await prisma.formTemplates.create({
    data: {
      Name: data!.name,
      Description: data!.description ?? null,
      FormCategoryID: data!.formCategoryId ?? null,
      WFDefinitionID: data!.wfDefinitionId ?? null,
      Status: data!.status,
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
    },
    include: { Fields: true },
  })
  return json(tmpl, 201)
}
