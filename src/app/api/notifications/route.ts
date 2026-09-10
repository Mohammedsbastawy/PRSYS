import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { json, unauthorized, forbidden, parseBody } from '@/lib/http'
import { getUserContext } from '@/lib/rbac'
import { z } from 'zod'

// GET /api/notifications — own notifications + unread count
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()
  const ctx = await getUserContext(payload.userId)
  if (!ctx) return forbidden()

  const [items, unreadCount] = await Promise.all([
    prisma.notifications.findMany({
      where: { UserID: payload.userId },
      include: { Request: { select: { RequestID: true, TrackingNumber: true } } },
      orderBy: { CreatedAt: 'desc' },
      take: 20,
    }),
    prisma.notifications.count({ where: { UserID: payload.userId, IsRead: false } }),
  ])
  return json({ items, unreadCount })
}

const markSchema = z.object({
  ids: z.array(z.string()).optional(),
  all: z.boolean().optional(),
})

// PATCH /api/notifications — mark read (ids or all)
export async function PATCH(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return unauthorized()

  const { data, error: err } = await parseBody(req, markSchema)
  if (err) return json({ error: err }, 400)

  const where: Record<string, unknown> = { UserID: payload.userId, IsRead: false }
  if (!data!.all) {
    if (!data!.ids || data!.ids.length === 0) return json({ error: 'ids or all required' }, 400)
    where.NotificationID = { in: data!.ids }
  }
  await prisma.notifications.updateMany({ where, data: { IsRead: true } })
  const unreadCount = await prisma.notifications.count({
    where: { UserID: payload.userId, IsRead: false },
  })
  return json({ ok: true, unreadCount })
}
