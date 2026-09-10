import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, parseBody, notFound } from '@/lib/http'
import { getUserContext, hasPermission } from '@/lib/rbac'
import { notifyUsers, usersWithPermission } from '@/lib/notifications'
import { z } from 'zod'

interface Params { params: { id: string } }

const commentSchema = z.object({
  text: z.string().min(1).max(5000),
  type: z.string().default('GENERAL'),
  isInternal: z.boolean().default(false),
})

// POST /api/requests/[id]/comments
export async function POST(req: NextRequest, { params }: Params) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx) return forbidden()

  const existing = await prisma.requests.findUnique({
    where: { RequestID: params.id },
    select: { RequestID: true, RequesterID: true, Status: true, TrackingNumber: true },
  })
  if (!existing) return notFound('Request not found')
  if (existing.RequesterID !== payload.userId && !hasPermission(ctx, 'REQUEST_VIEW_ALL')) {
    return forbidden()
  }

  const { data, error: err } = await parseBody(req, commentSchema)
  if (err) return json({ error: err }, 400)

  // only staff with full visibility can post internal notes
  const canInternal = hasPermission(ctx, 'REQUEST_VIEW_ALL')

  const comment = await prisma.requestComments.create({
    data: {
      RequestID: params.id,
      AuthorUserID: payload.userId,
      CommentText: data!.text.trim(),
      CommentType: data!.type,
      IsInternal: canInternal ? data!.isInternal : false,
    },
    include: { Author: { select: { UserID: true, Name: true, Role: { select: { Name: true } } } } },
  })

  // a requester reply automatically returns the request to the approval queue
  if (existing.Status === 'CLARIFICATION_REQUESTED' && payload.userId === existing.RequesterID) {
    await prisma.requests.update({
      where: { RequestID: params.id },
      data: { Status: 'PENDING_APPROVAL' },
    })
    await prisma.requestAuditLog.create({
      data: {
        RequestID: params.id,
        FromStatus: 'CLARIFICATION_REQUESTED',
        ToStatus: 'PENDING_APPROVAL',
        Action: 'CLARIFICATION_RESOLVED',
        ChangedByUserID: payload.userId,
      },
    })
    const approvers = (await usersWithPermission('REQUEST_APPROVE')).filter(
      (id) => id !== payload.userId
    )
    await notifyUsers(approvers, {
      title: `Requester replied on ${existing.TrackingNumber}`,
      message: 'Clarification provided — the request is back in your queue',
      type: 'CLARIFICATION_RESOLVED',
      requestId: params.id,
    })
  }

  return json(comment, 201)
}
