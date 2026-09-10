import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, notFound, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

interface Params { params: { id: string } }

const updateSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  sortOrder: z.number().int().optional(),
})

// PUT /api/form-categories/[id] — rename / reorder
export async function PUT(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'FORM_TEMPLATE_MANAGE')) return forbidden()

  const { data, error: err } = await parseBody(req, updateSchema)
  if (err) return json({ error: err }, 400)
  if (data!.name === undefined && data!.sortOrder === undefined) {
    return json({ error: 'Nothing to update' }, 400)
  }

  const existing = await prisma.formCategories.findUnique({
    where: { FormCategoryID: params.id },
    select: { FormCategoryID: true },
  })
  if (!existing) return notFound('Category not found')

  const cat = await prisma.formCategories.update({
    where: { FormCategoryID: params.id },
    data: {
      ...(data!.name !== undefined ? { Name: data!.name } : {}),
      ...(data!.sortOrder !== undefined ? { SortOrder: data!.sortOrder } : {}),
    },
    select: { FormCategoryID: true, Name: true, SortOrder: true },
  })
  return json(cat)
}

// DELETE /api/form-categories/[id] — blocked while templates use the category
export async function DELETE(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'FORM_TEMPLATE_MANAGE')) return forbidden()

  const cat = await prisma.formCategories.findUnique({
    where: { FormCategoryID: params.id },
    select: {
      FormCategoryID: true,
      Name: true,
      _count: { select: { Templates: true } },
    },
  })
  if (!cat) return notFound('Category not found')
  if (cat._count.Templates > 0) {
    return json(
      {
        error: `Cannot delete "${cat.Name}": ${cat._count.Templates} template(s) belong to this category. Move or delete them first.`,
      },
      409
    )
  }
  await prisma.formCategories.delete({ where: { FormCategoryID: params.id } })
  return json({ ok: true })
}
