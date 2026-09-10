import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

// GET /api/groups
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const groups = await prisma.groups.findMany({
    include: {
      Members: { include: { UserRef: { select: { UserID: true, Name: true, Email: true } } } },
    },
    orderBy: { Name: 'asc' },
  })
  return json(
    groups.map((g) => ({
      id: g.GroupID,
      name: g.Name,
      description: g.Description,
      members: g.Members.map((m) => m.UserRef),
    }))
  )
}

const groupSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  memberIds: z.array(z.string()).optional(),
})

// POST /api/groups
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'GROUP_MANAGE')) return forbidden()

  const { data, error: err } = await parseBody(req, groupSchema)
  if (err) return json({ error: err }, 400)

  const group = await prisma.groups.create({
    data: { Name: data!.name, Description: data!.description ?? null },
  })

  if (data!.memberIds?.length) {
    await prisma.groupMembers.createMany({
      data: data!.memberIds.map((uid) => ({ GroupID: group.GroupID, UserID: uid })),
    })
  }

  return json({ id: group.GroupID, name: group.Name }, 201)
}
