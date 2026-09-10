import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, error, unauthorized, forbidden, notFound, parseBody } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

interface Params { params: { id: string } }

const memberSchema = z.object({ userId: z.string().min(1, 'userId is required') })

// POST /api/groups/[id]/members — add member (GROUP_MANAGE)
export async function POST(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'GROUP_MANAGE')) return forbidden()

  const { data, error: err } = await parseBody(req, memberSchema)
  if (err) return error(err!)

  const group = await prisma.groups.findUnique({ where: { GroupID: params.id } })
  if (!group) return notFound('Group not found')
  const user = await prisma.users.findUnique({ where: { UserID: data!.userId } })
  if (!user) return notFound('User not found')

  const already = await prisma.groupMembers.findUnique({
    where: { GroupID_UserID: { GroupID: params.id, UserID: data!.userId } },
  })
  if (already) return error('User is already a member of this group', 409)

  await prisma.groupMembers.create({ data: { GroupID: params.id, UserID: data!.userId } })
  return json({ success: true })
}

// DELETE /api/groups/[id]/members — remove member (GROUP_MANAGE)
export async function DELETE(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx || !hasPermission(ctx, 'GROUP_MANAGE')) return forbidden()

  const userId = req.nextUrl.searchParams.get('userId')
  if (!userId) return error('userId query param is required')

  try {
    await prisma.groupMembers.delete({
      where: { GroupID_UserID: { GroupID: params.id, UserID: userId } },
    })
  } catch {
    return notFound('Membership not found')
  }
  return json({ success: true })
}
