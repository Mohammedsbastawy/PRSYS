import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

// GET /api/form-categories — managers see every template; others only visible ones
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx) return forbidden()

  const cats = await prisma.formCategories.findMany({
    include: {
      Templates: {
        select: {
          FormTemplateID: true,
          Name: true,
          Description: true,
          Status: true,
          OwnerDEP: { select: { Name: true } },
          OwnerGroup: { select: { Name: true } },
          FormPerms: {
            where: { PermissionType: 'VIEW' },
            select: { DEPID: true, GroupID: true, UserID: true },
          },
        },
      },
      _count: { select: { Templates: true } },
    },
    orderBy: { SortOrder: 'asc' },
  })

  const isManager = ctx.roleCode === 'SUPER_ADMIN' || hasPermission(ctx, 'FORM_TEMPLATE_MANAGE')

  // Non-managers: load the viewer's department + groups once, match in memory
  let depId: string | null = null
  let groupIds = new Set<string>()
  if (!isManager) {
    const me = await prisma.users.findUnique({
      where: { UserID: payload.userId },
      select: { DEPID: true },
    })
    depId = me?.DEPID ?? null
    const ms = await prisma.groupMembers.findMany({
      where: { UserID: payload.userId },
      select: { GroupID: true },
    })
    groupIds = new Set(ms.map((m) => m.GroupID))
  }

  return json(
    cats.map((c) => ({
      FormCategoryID: c.FormCategoryID,
      Name: c.Name,
      SortOrder: c.SortOrder,
      CreatedAt: c.CreatedAt,
      UpdatedAt: c.UpdatedAt,
      _count: c._count,
      Templates: c.Templates.filter(
        (t) =>
          isManager ||
          t.FormPerms.length === 0 ||
          t.FormPerms.some(
            (p) =>
              p.UserID === payload.userId ||
              (depId !== null && p.DEPID === depId) ||
              (p.GroupID !== null && groupIds.has(p.GroupID))
          )
      ).map((t) => ({
        FormTemplateID: t.FormTemplateID,
        Name: t.Name,
        Description: t.Description,
        Status: t.Status,
        ownerName: t.OwnerDEP?.Name ?? t.OwnerGroup?.Name ?? null,
      })),
    }))
  )
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
