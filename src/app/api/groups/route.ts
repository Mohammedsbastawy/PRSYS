import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, error, unauthorized, forbidden, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

// GET /api/groups — list with members & usage counts (workflows / form permissions)
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()

  const groups = await prisma.groups.findMany({
    include: {
      Members: { include: { UserRef: { select: { UserID: true, Name: true, Email: true, IsActive: true, DEPID: true } } } },
      _count: { select: { WFSteps: true, FormPerms: true } },
    },
    orderBy: { Name: 'asc' },
  })
  const deps = await prisma.dEP.findMany({ select: { DEPID: true, Name: true } })
  const depMap = new Map(deps.map((d) => [d.DEPID, d.Name]))

  return json(
    groups.map((g) => ({
      id: g.GroupID,
      name: g.Name,
      description: g.Description,
      workflowCount: g._count.WFSteps,
      formPermCount: g._count.FormPerms,
      members: g.Members.map((m) => ({
        UserID: m.UserRef.UserID,
        Name: m.UserRef.Name,
        Email: m.UserRef.Email,
        IsActive: m.UserRef.IsActive,
        department: m.UserRef.DEPID ? (depMap.get(m.UserRef.DEPID) ?? null) : null,
      })),
    }))
  )
}

const groupSchema = z.object({
  name: z.string().min(1, 'Group name is required'),
  description: z.string().optional().nullable(),
  memberIds: z.array(z.string()).optional(),
})

// POST /api/groups (GROUP_MANAGE)
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'GROUP_MANAGE')) return forbidden()

  const { data, error: err } = await parseBody(req, groupSchema)
  if (err) return error(err!)

  const group = await prisma.groups.create({
    data: { Name: data!.name.trim(), Description: data!.description?.trim() || null },
  })

  if (data!.memberIds?.length) {
    await prisma.groupMembers.createMany({
      data: data!.memberIds.map((uid) => ({ GroupID: group.GroupID, UserID: uid })),
    })
  }

  return json({ id: group.GroupID, name: group.Name }, 201)
}
