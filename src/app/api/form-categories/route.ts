import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

// GET /api/form-categories
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const cats = await prisma.formCategories.findMany({
    include: { Templates: { select: { FormTemplateID: true, Name: true, Status: true } } },
    orderBy: { SortOrder: 'asc' },
  })
  return json(cats)
}

const catSchema = z.object({
  name: z.string().min(1),
  sortOrder: z.number().int().default(0),
})

// POST /api/form-categories
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'FORM_TEMPLATE_MANAGE')) return forbidden()

  const { data, error: err } = await parseBody(req, catSchema)
  if (err) return json({ error: err }, 400)

  const cat = await prisma.formCategories.create({
    data: { Name: data!.name, SortOrder: data!.sortOrder },
    select: { FormCategoryID: true, Name: true },
  })
  return json(cat, 201)
}
