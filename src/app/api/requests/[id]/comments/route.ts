import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, parseBody, notFound } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { z } from 'zod'

interface Params { params: { id: string } }

const commentSchema = z.object({
  text: z.string().min(1),
  type: z.string().default('GENERAL'),
  isInternal: z.boolean().default(false),
})

// POST /api/requests/[id]/comments
export async function POST(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx) return forbidden()

  const existing = await prisma.requests.findUnique({ where: { RequestID: params.id } })
  if (!existing) return notFound('Request not found')

  const { data, error: err } = await parseBody(req, commentSchema)
  if (err) return json({ error: err }, 400)

  const comment = await prisma.requestComments.create({
    data: {
      RequestID: params.id,
      AuthorUserID: payload.userId,
      CommentText: data!.text,
      CommentType: data!.type,
      IsInternal: data!.isInternal,
    },
    include: { Author: { select: { UserID: true, Name: true } } },
  })
  return json(comment, 201)
}
